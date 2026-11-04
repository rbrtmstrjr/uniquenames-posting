"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CardRow, FacebookState, PostRow } from "@/lib/db/types";
import { FacebookError, facebookConfig, graphClient, type FacebookConfig } from "@/lib/facebook/graph";
import { cardOrder } from "@/lib/files/save";
// Scheduling window (Facebook takes 10 minutes to 30 days; the margins leave time for the uploads) and the age at which
// a cut-off 'publishing' counts as unsure: shared with the panel.
import { SCHEDULE_MAX_MS, SCHEDULE_MIN_MS, STALE_PUBLISHING_MS } from "@/lib/facebook/schedule";
import { UUID_RE } from "./helpers";
import { fail, requireOwner, type ActionResult } from "./result";
import { updateCaptionAction } from "./posts";

// Post now / Schedule to Facebook (2026-11-04, spec docs/superpowers/specs/2026-11-04-facebook-posting-design.md):
// the post's selected cards, in the upload order, as ONE multi-photo post through the official Graph API. Posting
// only. The one safeguard is fb_state: taken with one conditional update before anything is sent, so the same album
// is never posted twice (a double tap, two tabs, or a retry after Facebook went quiet).

const UPLOADS_AT_ONCE = 4;
/** Signed links Facebook fetches the card files from. */
const LINK_TTL_S = 3600;

const NOT_CONNECTED = "Connect Facebook first: add FACEBOOK_PAGE_ID, FACEBOOK_PAGE_TOKEN and FACEBOOK_APP_SECRET in Vercel (see docs/SETUP.md, \"Posting to Facebook\").";
const NEEDS_021 = "Posting to Facebook needs a database update first: run supabase/migrations/021_facebook_posting.sql in Supabase. Nothing was sent.";
const NOTHING_SENT = "Nothing was posted.";


/** What the owner reads for a Facebook error, ending with `tail` (what did not happen: "Nothing was posted."). */
function explain(e: unknown, tail = NOTHING_SENT): string {
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

export async function publishToFacebookAction(postId: string, input: {
  caption: string;
  /** ISO time to schedule at (Facebook holds the post until then); absent = post now. */
  scheduledAt?: string | null;
  /** The owner checked the Page after an "unsure" and chose Retry anyway. */
  retryUnsure?: boolean;
}): Promise<ActionResult<{ state: "published" | "scheduled"; permalink: string | null; scheduledFor: string | null }>> {
  await requireOwner();
  if (!UUID_RE.test(postId ?? "")) return fail("Post not found.");
  const cfg = facebookConfig();
  if (!cfg) return fail(NOT_CONNECTED);
  const caption = String(input.caption ?? "");
  if (caption.length > 5000) return fail("The caption is too long.");
  let scheduledAt: Date | null = null;
  if (input.scheduledAt) {
    scheduledAt = new Date(input.scheduledAt);
    const ahead = scheduledAt.getTime() - Date.now();
    if (Number.isNaN(ahead)) return fail("Pick a valid date and time.");
    if (ahead < SCHEDULE_MIN_MS) return fail("Pick a time at least 15 minutes from now.");
    if (ahead > SCHEDULE_MAX_MS) return fail("Facebook schedules up to 29 days ahead. Pick an earlier date.");
  }

  const sb = await createClient();
  const [{ data: post, error: postErr }, { data: cardRows, error: cardsErr }] = await Promise.all([
    sb.from("posts").select("*").eq("id", postId).maybeSingle(),
    sb.from("cards").select("id, kind, selected, status, card_path, order_index, position").eq("post_id", postId),
  ]);
  if (postErr || cardsErr) return fail((postErr ?? cardsErr)!.message);
  if (!post) return fail("Post not found.");
  const p = post as PostRow;
  if (!("fb_state" in p)) return fail(NEEDS_021);
  if (p.fb_state === "published" || p.fb_state === "scheduled") return fail("This post is already on Facebook.");
  const picked = ((cardRows ?? []) as Pick<CardRow, "id" | "kind" | "selected" | "status" | "card_path" | "order_index" | "position">[])
    .filter((c) => c.selected).sort(cardOrder);
  if (!picked.length) return fail("Select at least one card to post.");
  const notReady = picked.filter((c) => c.status !== "done" || !c.card_path).length;
  if (notReady) return fail(`${notReady} selected card${notReady === 1 ? " is" : "s are"} not ready yet. Wait for ${notReady === 1 ? "it" : "them"} to finish (or unselect), then post.`);

  // The caption as shown in the box, saved on the post first (the same save as editing it by hand).
  if (caption !== p.caption) {
    const saved = await updateCaptionAction(postId, caption);
    if (!saved.ok) return fail(`Could not save the caption: ${saved.error} ${NOTHING_SENT}`);
  }

  // The lock: from "no Facebook post yet" only (unsure only on purpose; a stale 'publishing' counts as unsure).
  const staleBefore = new Date(Date.now() - STALE_PUBLISHING_MS).toISOString();
  const from = ["fb_state.is.null", "fb_state.eq.failed", ...(input.retryUnsure ? ["fb_state.eq.unsure", `and(fb_state.eq.publishing,fb_attempt_at.lt.${staleBefore})`] : [])];
  const { data: locked, error: lockErr } = await sb.from("posts")
    .update({ fb_state: "publishing", fb_attempt_at: new Date().toISOString(), fb_error: null })
    .eq("id", postId).or(from.join(",")).select("id");
  if (lockErr) return fail(lockErr.message);
  if (!locked?.length) {
    return fail(p.fb_state === "unsure" || p.fb_state === "publishing"
      ? "This post may already be on Facebook. Check your Page, then use Retry anyway if it isn't there."
      : "This post is being sent to Facebook right now. Reload the page in a moment.");
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
    return fail(msg);
  }

  // 2. ONE post with every photo, in order. No answer here = unknown: never retried by itself.
  let fbPostId: string;
  try {
    fbPostId = await fb.createPost({ message: caption, photoIds, scheduledAt: scheduledAt ?? undefined });
  } catch (e) {
    if (e instanceof FacebookError && e.kind === "network") {
      await settle("unsure", UNSURE);
      return fail(UNSURE);
    }
    const msg = explain(e);
    await settle("failed", msg);
    return fail(msg);
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
  if (saveErr) return fail(`It is on Facebook, but the app could not record it (${saveErr.message}). Don't post it again: reload the page.`);
  return { ok: true, state, permalink, scheduledFor: scheduledAt ? at : null };
}

/** Cancel a scheduled post: Facebook deletes it, and the post here goes back to ready. */
export async function cancelFacebookScheduleAction(postId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(postId ?? "")) return fail("Post not found.");
  const cfg = facebookConfig();
  if (!cfg) return fail(NOT_CONNECTED);
  const sb = await createClient();
  const { data: post, error } = await sb.from("posts").select("*").eq("id", postId).maybeSingle();
  if (error) return fail(error.message);
  const p = post as PostRow | null;
  if (!p) return fail("Post not found.");
  if (p.fb_state !== "scheduled" || !p.fb_post_id) return fail("This post is not scheduled on Facebook.");
  try {
    await graphClient(cfg).deletePost(p.fb_post_id);
  } catch (e) {
    return fail(e instanceof FacebookError && e.kind === "other" ? `Facebook could not cancel it: ${e.message} It may already be posted; check your Page.` : explain(e, "Nothing was cancelled."));
  }
  const { error: saveErr } = await sb.from("posts").update({
    fb_post_id: null, fb_permalink: null, fb_state: null, fb_scheduled_for: null, fb_error: null, status: "ready", posted_at: null,
  }).eq("id", postId);
  if (saveErr) return fail(`Cancelled on Facebook, but the app could not record it: ${saveErr.message}`);
  await sb.rpc("refresh_post", { p_post: postId });
  revalidatePath("/", "layout");
  revalidatePath("/posts");
  return { ok: true };
}

/** Settings: do the keys work? The Page's name, or what to fix. */
export async function checkFacebookAction(): Promise<ActionResult<{ pageName: string }>> {
  await requireOwner();
  const cfg: FacebookConfig | null = facebookConfig();
  if (!cfg) return fail(NOT_CONNECTED);
  try {
    return { ok: true, pageName: await graphClient(cfg).pageName() };
  } catch (e) {
    return fail(explain(e, ""));
  }
}
