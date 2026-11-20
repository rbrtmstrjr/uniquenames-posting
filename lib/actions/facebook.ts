"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { PostRow } from "@/lib/db/types";
import { FacebookError, facebookConfig, graphClient, type FacebookConfig } from "@/lib/facebook/graph";
import { NOT_CONNECTED, NOTHING_SENT, explain, publishPost, type PublishResult } from "@/lib/facebook/publish";
import { UUID_RE } from "./helpers";
import { fail, requireOwner, type ActionResult } from "./result";
import { updateCaptionAction } from "./posts";

// Post now / Schedule to Facebook: the logic is in lib/facebook/publish.ts (shared with Autopilot).

export async function publishToFacebookAction(postId: string, input: {
  caption: string;
  /** ISO time to schedule at (Facebook holds the post until then); absent = post now. */
  scheduledAt?: string | null;
  /** The owner checked the Page after an "unsure" and chose Retry anyway. */
  retryUnsure?: boolean;
}): Promise<PublishResult> {
  await requireOwner();
  const caption = String(input.caption ?? "");
  return publishPost(await createClient(), postId, {
    caption, scheduledAt: input.scheduledAt, retryUnsure: input.retryUnsure,
    // The caption as shown in the box, saved on the post first (the same save as editing it by hand).
    beforeSend: async (p) => {
      if (caption === p.caption) return null;
      const saved = await updateCaptionAction(postId, caption);
      return saved.ok ? null : `Could not save the caption: ${saved.error} ${NOTHING_SENT}`;
    },
  });
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
