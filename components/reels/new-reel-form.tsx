"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, PenLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { writeReelScriptAction } from "@/lib/actions/reels";
import { callAction } from "@/lib/actions/call";
import { clock } from "@/lib/reels/status";
import { useNow } from "@/lib/realtime/hooks";

const TOPIC_MAX = 120;

/** What the owner sees while Gemini writes (it can take a few minutes with rewrites). */
const STAGES = [
  { after: 0, text: "Picking the story and the two dolls…" },
  { after: 25, text: "Writing short lines, one picture each…" },
  { after: 70, text: "Checking the length and the title…" },
  { after: 130, text: "Still going — the AI is rewriting it to fit. Hang on…" },
];

/** The live "what's happening" line + timer while Gemini writes (ticks on its own). */
function Writing({ since }: { since: number }) {
  const elapsed = Math.max(0, (useNow(1000) - since) / 1000);
  const stage = [...STAGES].reverse().find((s) => elapsed >= s.after) ?? STAGES[0];
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-semibold text-ink">{stage.text}</span>
      <span className="shrink-0 tabular-nums text-muted">{clock(elapsed)}</span>
    </div>
  );
}

export function NewReelForm() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [since, setSince] = useState(0);

  const write = async () => {
    if (busy) return;
    setBusy(true); setError(null); setSince(Date.now());
    const t = topic.replace(/\s+/g, " ").trim();
    const r = await callAction(() => writeReelScriptAction(t ? { topic: t } : {}));
    if (r.ok) { router.push(`/reels/${r.reelId}`); return; } // stays "busy" until the review page arrives
    setBusy(false);
    setError(r.error);
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel title="New reel">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void write(); }}>
          <div className="space-y-2">
            <Label htmlFor="reel-topic" className="text-sm font-semibold text-ink">Topic <span className="font-normal text-muted">(optional)</span></Label>
            <Input id="reel-topic" value={topic} maxLength={TOPIC_MAX} disabled={busy} autoComplete="off"
              placeholder="e.g. why toddlers say no" onChange={(e) => setTopic(e.target.value)} />
            <p className="text-xs text-muted">Leave it blank and the AI picks a proven parenting topic you haven&apos;t used lately, in the next of the 5 story formats.</p>
          </div>

          {error && !busy && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{error}</span>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">Nothing is made on your PC until you approve the script.</p>
            <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto">
              {!busy && (error ? <PenLine className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />)}
              {busy ? "Writing script…" : error ? "Try again" : "Write script"}
            </Button>
          </div>
        </form>

        {busy && (
          <div role="status" aria-live="polite" className="mt-5 space-y-3 rounded-xl bg-surface-2/60 p-4">
            <Writing since={since} />
            <p className="text-xs text-muted">Usually 1–3 minutes. Keep this page open — the script opens by itself when it&apos;s ready.</p>
            <ol className="space-y-2 pt-1" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex items-start gap-3">
                  <Skeleton className="size-7 shrink-0 rounded-full" />
                  <Skeleton className="h-11 flex-1" />
                </li>
              ))}
            </ol>
          </div>
        )}
      </Panel>

      <Panel title="How it works" className="lg:sticky lg:top-20">
        <ol className="space-y-3 text-sm text-ink">
          {[
            ["Write", "The AI writes a 60–90 second lesson: about 25–35 short lines, one picture each, with a fresh hook every few seconds."],
            ["Check", "Read the lines, fix any words, then approve."],
            ["Make", "Your PC records the voice, makes the pictures in your style (Crayon or Red Thread) and the captioned video."],
            ["Save", "The full video lands in Pictures › Unique Names › Reels; a preview plays here."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">{i + 1}</span>
              <span><strong className="font-semibold">{t}.</strong> <span className="text-muted">{d}</span></span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
