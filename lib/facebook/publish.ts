import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardRow, FacebookState, PostRow } from "@/lib/db/types";
import { FacebookError, facebookConfig, graphClient } from "./graph";
import { cardOrder } from "@/lib/files/save";
// Scheduling window (Facebook takes 10 minutes to 30 days; the margins leave time for the uploads) and the age at which
// a cut-off 'publishing' counts as unsure: shared with the panel.
import { SCHEDULE_MAX_MS, SCHEDULE_MIN_MS, STALE_PUBLISHING_MS } from "./schedule";
import { UUID_RE } from "@/lib/actions/helpers";

// Post now / Schedule to Facebook (2026-11-04, spec docs/superpowers/specs/2026-11-04-facebook-posting-design.md):
// the post's selected cards, in the upload order, as ONE multi-photo post through the official Graph API. Posting
// only. The one safeguard is fb_state: taken with one conditional update before anything is sent, so the same album
// is never posted twice (a double tap, two tabs, or a retry after Facebook went quiet).

const UPLOADS_AT_ONCE = 4;
/** Signed links Facebook fetches the card files from. */
const LINK_TTL_S = 3600;

export const NOT_CONNECTED = "Connect Facebook first: add FACEBOOK_PAGE_ID, FACEBOOK_PAGE_TOKEN and FACEBOOK_APP_SECRET in Vercel (see docs/SETUP.md, \"Posting to Facebook\").";
const NEEDS_021 = "Posting to Facebook needs a database update first: run supabase/migrations/021_facebook_posting.sql in Supabase. Nothing was sent.";
export const NOTHING_SENT = "Nothing was posted.";


/** What the owner reads for a Facebook error, ending with `tail` (what did not happen: "Nothing was posted."). */
export function explain(e: unknown, tail = NOTHING_SENT): string {
  const end = tail ? ` ${tail}` : "";
  if (!(e instanceof FacebookError)) return `Something went wrong: ${(e as Error)?.message || "unknown error"}.${end}`;
  switch (e.kind) {
    case "auth": return `Facebook no longer accepts the app's key (it expired, the password changed, or your Page role changed). Make a new Page token and update FACEBOOK_PAGE_TOKEN in Vercel.${end}`;
    case "blocked": return `Facebook has paused posting from this Page for now (a temporary block). Wait a few hours, then try again.${end}`;
    case "rate": return `Facebook says too many requests right now. Wait a few minutes, then try again.${end}`;
    case "network": return `Couldn't reach Facebook.${end} Try again.`;
    default: return `Facebook refused: ${e.message}${end}`;
  }
}

const UNSURE = "Facebook didn't answer while the post was being created, so it may or may not be on your Page. Check your Page first, and use Retry anyway only if it isn't there.";

/** `items` mapped `at` a time, keeping their order. */
async function inBatches<T, R>(items: T[], at: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += at) out.push(...(await Promise.all(items.slice(i, i + at).map(fn))));
  return out;
}

export type PublishErrorKind = "not_connected" | "invalid" | "auth" | "blocked" | "rate" | "network" | "other" | "unsure" | "db";
export type PublishResult =
  | { ok: true; state: "published" | "scheduled"; permalink: string | null; scheduledFor: string | null }
  | { ok: false; error: string; errorKind: PublishErrorKind };

const no = (error: string, errorKind: PublishErrorKind): PublishResult => ({ ok: false, error, errorKind });
const kindOf = (e: unknown): PublishErrorKind => (e instanceof FacebookError ? e.kind : "other");

/**
 * The selected cards, in the upload order, as ONE multi-photo post (now, or scheduled): the post page's Post now /
 * Schedule and Autopilot. fb_state is taken with one conditional update before anything is sent, so the same album
 * is never posted twice. `beforeSend` runs after the checks and before the lock (the post page saves an edited caption).
 */
export async function publishPost(sb: SupabaseClient, postId: string, input: {
  caption: string;
  /** ISO time to schedule at (Facebook holds the post until then); absent = post now. */
  scheduledAt?: string | null;
  /** The owner checked the Page after an "unsure" and chose Retry anyway. */
  retryUnsure?: boolean;
  beforeSend?: (p: PostRow) => Promise<string | null>;
}): Promise<PublishResult> {
  if (!UUID_RE.test(postId ?? "")) return no("Post not found.", "invalid");
  const cfg = facebookConfig();
  if (!cfg) return no(NOT_CONNECTED, "not_connected");
  const caption = String(input.caption ?? "");
  if (caption.length > 5000) return no("The caption is too long.", "invalid");
  let scheduledAt: Date | null = null;
  if (input.scheduledAt) {
    scheduledAt = new Date(input.scheduledAt);
    const ahead = scheduledAt.getTime() - Date.now();
    if (Number.isNaN(ahead)) return no("Pick a valid date and time.", "invalid");
    if (ahead < SCHEDULE_MIN_MS) return no("Pick a time at least 15 minutes from now.", "invalid");
    if (ahead > SCHEDULE_MAX_MS) return no("Facebook schedules up to 29 days ahead. Pick an earlier date.", "invalid");
  }

  const [{ data: post, error: postErr }, { data: cardRows, error: cardsErr }] = await Promise.all([
    sb.from("posts").select("*").eq("id", postId).maybeSingle(),
    sb.from("cards").select("id, kind, selected, status, card_path, order_index, position").eq("post_id", postId),
  ]);
  if (postErr || cardsErr) return no((postErr ?? cardsErr)!.message, "db");
  if (!post) return no("Post not found.", "invalid");
  const p = post as PostRow;
  if (!("fb_state" in p)) return no(NEEDS_021, "db");
  if (p.fb_state === "published" || p.fb_state === "scheduled") return no("This post is already on Facebook.", "invalid");
  const picked = ((cardRows ?? []) as Pick<CardRow, "id" | "kind" | "selected" | "status" | "card_path" | "order_index" | "position">[])
    .filter((c) => c.selected).sort(cardOrder);
  if (!picked.length) return no("Select at least one card to post.", "invalid");
  const notReady = picked.filter((c) => c.status !== "done" || !c.card_path).length;
  if (notReady) return no(`${notReady} selected card${notReady === 1 ? " is" : "s are"} not ready yet. Wait for ${notReady === 1 ? "it" : "them"} to finish (or unselect), then post.`, "invalid");

  if (input.beforeSend) {
    const stop = await input.beforeSend(p);
    if (stop) return no(stop, "db");
  }

  // The lock: from "no Facebook post yet" only (unsure only on purpose; a stale 'publishing' counts as unsure).
  const staleBefore = new Date(Date.now() - STALE_PUBLISHING_MS).toISOString();
  const from = ["fb_state.is.null", "fb_state.eq.failed", ...(input.retryUnsure ? ["fb_state.eq.unsure", `and(fb_state.eq.publishing,fb_attempt_at.lt.${staleBefore})`] : [])];
  const { data: locked, error: lockErr } = await sb.from("posts")
    .update({ fb_state: "publishing", fb_attempt_at: new Date().toISOString(), fb_error: null })
    .eq("id", postId).or(from.join(",")).select("id");
  if (lockErr) return no(lockErr.message, "db");
  if (!locked?.length) {
    return no(p.fb_state === "unsure" || p.fb_state === "publishing"
      ? "This post may already be on Facebook. Check your Page, then use Retry anyway if it isn't there."
      : "This post is being sent to Facebook right now. Reload the page in a moment.", "invalid");
  }
  const settle = (state: FacebookState, error: string | null) =>
    sb.from("posts").update({ fb_state: state, fb_error: error ? error.slice(0, 500) : null }).eq("id", postId);

  // 1. The card files, uploaded unpublished: Facebook fetches each from a short-lived signed link.
  const fb = graphClient(cfg);
  let photoIds: string[];
  try {
    const { data: links, error: linkErr } = await sb.storage.from("cards").createSignedUrls(picked.map((c) => c.card_path!), LINK_TTL_S);
    const urls = (links ?? []).map((l) => l.signedUrl ?? "");
    if (linkErr || urls.length !== picked.length || urls.some((u) => !u)) throw new Error(linkErr?.message || "could not make links to the card files");
    photoIds = await inBatches(urls, UPLOADS_AT_ONCE, (url) => fb.uploadPhoto(url, { temporary: !!scheduledAt }));
  } catch (e) {
    const msg = explain(e);
    await settle("failed", msg);
    return no(msg, kindOf(e));
  }

  // 2. ONE post with every photo, in order. No answer here = unknown: never retried by itself.
  let fbPostId: string;
  try {
    fbPostId = await fb.createPost({ message: caption, photoIds, scheduledAt: scheduledAt ?? undefined });
  } catch (e) {
    if (e instanceof FacebookError && e.kind === "network") {
      await settle("unsure", UNSURE);
      return no(UNSURE, "unsure");
    }
    const msg = explain(e);
    await settle("failed", msg);
    return no(msg, kindOf(e));
  }

  // 3. On Facebook: remember it, and mark the post posted (at the scheduled time for a scheduled one).
  const permalink = await fb.permalink(fbPostId).catch(() => null);
  const state = scheduledAt ? "scheduled" as const : "published" as const;
  const at = (scheduledAt ?? new Date()).toISOString();
  const { error: saveErr } = await sb.from("posts").update({
    fb_post_id: fbPostId, fb_permalink: permalink, fb_state: state, fb_scheduled_for: scheduledAt ? at : null, fb_error: null,
    status: "posted", posted_at: at,
  }).eq("id", postId);
  revalidatePath("/", "layout");
  revalidatePath("/posts");
  if (saveErr) return no(`It is on Facebook, but the app could not record it (${saveErr.message}). Don't post it again: reload the page.`, "db");
  return { ok: true, state, permalink, scheduledFor: scheduledAt ? at : null };
}
