"use client";
import { useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ExternalLink, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { CardRow, PostRow } from "@/lib/db/types";
import { orderedSelection } from "@/lib/files/save";
import { cancelFacebookScheduleAction, publishToFacebookAction } from "@/lib/actions/facebook";
import { OFFLINE_ERROR, callAction } from "@/lib/actions/call";
import { useNow } from "@/lib/realtime/hooks";
import {
  defaultScheduleTime, facebookView, fromManilaInput, manilaInputValue, manilaLabel, scheduleBounds, scheduleProblem,
} from "@/lib/facebook/schedule";

// Post now / Schedule to Facebook (2026-11-04): the selected cards in the upload order, as ONE post with the caption
// as it is in the box. Posting only. The server never posts the same album twice (fb_state); this panel shows where
// the post stands and asks before anything goes out.

const LOST = "The app lost touch with the server while posting. It may still finish: wait for this panel to update before you try again.";

export function FacebookPanel({ post, cards, caption, connected, onPatch }: {
  post: PostRow; cards: CardRow[];
  /** The caption as it is in the box now. */
  caption: string;
  /** All three Facebook keys are set on the server. */
  connected: boolean;
  /** Show the new Facebook state at once (realtime confirms it). */
  onPatch: (p: Partial<PostRow>) => void;
}) {
  const now = useNow(30_000);
  const view = facebookView(post, now);
  const picked = orderedSelection(cards);
  const notReady = picked.filter((c) => c.status !== "done" || !c.card_path).length;
  const [busy, setBusy] = useState<null | "post" | "schedule" | "cancel">(null);
  const [ask, setAsk] = useState<null | "post" | "retry" | "schedule" | "cancel">(null);
  const [when, setWhen] = useState(() => manilaInputValue(defaultScheduleTime(new Date())));
  const bounds = scheduleBounds(new Date(now));
  const whenProblem = scheduleProblem(fromManilaInput(when), new Date(now));

  const blocked = !connected ? "Connect Facebook first (Settings > Facebook)."
    : !picked.length ? "Select at least one card."
      : notReady ? `${notReady} selected card${notReady === 1 ? " is" : "s are"} not ready yet.`
        : null;

  const publish = async (o: { scheduledAt?: string; retryUnsure?: boolean }) => {
    const kind = o.scheduledAt ? "schedule" : "post";
    setBusy(kind);
    setAsk(null);
    onPatch({ fb_state: "publishing", fb_attempt_at: new Date().toISOString(), fb_error: null });
    const r = await callAction(() => publishToFacebookAction(post.id, { caption, ...o }));
    setBusy(null);
    if (r.ok) {
      onPatch({ fb_state: r.state, fb_permalink: r.permalink, fb_scheduled_for: r.scheduledFor, fb_error: null, status: "posted" });
      toast.success(r.state === "scheduled" ? `Scheduled for ${manilaLabel(r.scheduledFor!)}` : "Posted to Facebook");
      return;
    }
    if (r.error === OFFLINE_ERROR) { toast.warning(LOST, { duration: 12000 }); return; }
    // The server recorded what happened (failed / unsure); realtime brings it. Until then, show the reason.
    onPatch({ fb_state: post.fb_state ?? null, fb_error: r.error });
    toast.error(r.error, { duration: 10000 });
  };

  const cancel = async () => {
    setBusy("cancel");
    setAsk(null);
    const r = await callAction(() => cancelFacebookScheduleAction(post.id));
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    onPatch({ fb_state: null, fb_post_id: null, fb_permalink: null, fb_scheduled_for: null, status: "ready", posted_at: null });
    toast.success("Schedule cancelled. The post is back to ready.");
  };

  const n = picked.length;
  const cardsText = `${n} card${n === 1 ? "" : "s"}`;
  const buttons = (retry: boolean) => (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setAsk(retry ? "retry" : "post")} loading={busy === "post"} disabled={!!blocked || busy !== null}>
        <Send className="size-4" /> {retry ? "Retry anyway" : "Post now"}
      </Button>
      {!retry && (
        <Button variant="subtle" onClick={() => setAsk("schedule")} loading={busy === "schedule"} disabled={!!blocked || busy !== null}>
          <CalendarClock className="size-4" /> Schedule
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-2" data-testid="facebook-panel">
      {view.kind === "published" || view.kind === "scheduled-done" ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink">
          <CheckCircle2 className="size-4 text-accent" aria-hidden />
          {view.kind === "published" ? "Posted to Facebook" : `Posted to Facebook (scheduled for ${manilaLabel(view.at)})`}
          {view.link && <a href={view.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">View post <ExternalLink className="size-3.5" aria-hidden /></a>}
        </p>
      ) : view.kind === "scheduled" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><CalendarClock className="size-4 text-accent" aria-hidden /> Scheduled for {manilaLabel(view.at)}</p>
          <Button variant="ghost" size="sm" onClick={() => setAsk("cancel")} loading={busy === "cancel"} disabled={busy !== null}>Cancel schedule</Button>
        </div>
      ) : view.kind === "sending" ? (
        <p className="text-sm font-semibold text-ink" role="status">Sending to Facebook…</p>
      ) : view.kind === "unsure" ? (
        <div className="space-y-2 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn-text" role="alert">
          <p className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            Facebook didn&apos;t answer while this post was being created, so it may or may not be on your Page. Check your Page first, and retry only if it isn&apos;t there.</p>
          {buttons(true)}
        </div>
      ) : (
        <>
          {buttons(false)}
          {view.kind === "failed" && <p className="text-xs text-bad" role="status">{view.error}</p>}
        </>
      )}
      {blocked && (view.kind === "ready" || view.kind === "failed" || view.kind === "unsure") && <p className="text-xs text-muted">{blocked}</p>}

      <Dialog open={ask === "post" || ask === "retry"} onOpenChange={(o) => !o && setAsk(null)} title={ask === "retry" ? "Post again?" : "Post to Facebook now?"}
        description={ask === "retry"
          ? "Only do this if you checked your Page and the post is NOT there. Otherwise it will be on your Page twice."
          : `${cardsText} go out as one post, in this order, with the caption as it is in the box.`}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAsk(null)}>Not yet</Button>
          <Button onClick={() => void publish({ retryUnsure: ask === "retry" })}><Send className="size-4" /> {ask === "retry" ? "Post again" : "Post now"}</Button>
        </div>
      </Dialog>

      <Dialog open={ask === "schedule"} onOpenChange={(o) => !o && setAsk(null)} title="Schedule on Facebook"
        description={`${cardsText} go out as one post at this time (Manila). Facebook holds it, so your PC and this app can be off.`}>
        <div className="space-y-3">
          <label htmlFor="fb-when" className="block text-sm font-semibold text-ink">Date and time</label>
          <input id="fb-when" type="datetime-local" value={when} min={bounds.min} max={bounds.max} onChange={(e) => setWhen(e.target.value)}
            className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink" />
          {whenProblem && <p className="text-xs text-bad" role="status">{whenProblem}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAsk(null)}>Not yet</Button>
            <Button disabled={!!whenProblem} onClick={() => void publish({ scheduledAt: fromManilaInput(when)!.toISOString() })}>
              <CalendarClock className="size-4" /> Schedule
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={ask === "cancel"} onOpenChange={(o) => !o && setAsk(null)} title="Cancel the schedule?"
        description="Facebook deletes the scheduled post, and this post goes back to ready. You can post or schedule it again.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAsk(null)}>Keep it</Button>
          <Button variant="danger" onClick={() => void cancel()}>Cancel schedule</Button>
        </div>
      </Dialog>
    </div>
  );
}
