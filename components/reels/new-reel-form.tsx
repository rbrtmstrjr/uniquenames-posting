"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Lightbulb, PenLine, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { suggestReelTopicsAction, writeReelScriptAction } from "@/lib/actions/reels";
import { callAction } from "@/lib/actions/call";
import { FORMAT_SPECS } from "@/lib/reels/formats";
import type { TopicIdea } from "@/lib/reels/topic-ideas";
import { clock } from "@/lib/reels/status";
import { useNow } from "@/lib/realtime/hooks";
import { cn } from "@/lib/utils/cn";

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

/** One tappable topic idea: the topic, its format, the opening hook and what moms learn. */
function IdeaCard({ idea, on, disabled, onPick }: { idea: TopicIdea; on: boolean; disabled: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} aria-pressed={on} disabled={disabled}
      className={cn("flex min-h-11 w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors disabled:opacity-60",
        on ? "bg-accent-soft ring-2 ring-accent/60" : "bg-surface-2 hover:bg-accent-soft")}>
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone="accent" className="px-2 py-0.5">{FORMAT_SPECS[idea.format].label}</Badge>
          {idea.health && <Badge tone="warn" className="px-2 py-0.5">Health</Badge>}
        </span>
        <span className="block text-sm font-bold text-ink">{idea.topic}</span>
        <span className="block text-sm italic text-ink/80">&ldquo;{idea.hook}&rdquo;</span>
        <span className="block text-xs text-muted">{idea.why}</span>
      </span>
      {on && <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />}
    </button>
  );
}

export function NewReelForm() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [since, setSince] = useState(0);
  // "Suggest topics": the current batch, every topic shown so far ("More ideas" skips them) and the picked card
  const [ideas, setIdeas] = useState<TopicIdea[]>([]);
  const [shown, setShown] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [picked, setPicked] = useState<TopicIdea | null>(null);

  const suggest = async () => {
    if (suggesting || busy) return;
    setSuggesting(true); setSuggestError(null);
    const r = await callAction(() => suggestReelTopicsAction({ exclude: shown }));
    setSuggesting(false);
    if (!r.ok) { setSuggestError(r.error); return; }
    setIdeas(r.ideas);
    setShown((s) => [...s, ...r.ideas.map((i) => i.topic)]);
  };

  const pick = (idea: TopicIdea) => {
    if (picked?.topic === idea.topic) { setPicked(null); return; } // tap again: unpick (the topic stays, editable)
    setPicked(idea); setTopic(idea.topic); setError(null);
  };

  // Typing (or clearing) changes the topic: the card's format / bank idea no longer applies.
  const type = (v: string) => {
    setTopic(v);
    if (picked && v !== picked.topic) setPicked(null);
  };

  const write = async () => {
    if (busy) return;
    setBusy(true); setError(null); setSince(Date.now());
    const t = topic.replace(/\s+/g, " ").trim();
    const card = picked && t === picked.topic ? picked : null;
    const input = card
      ? { topic: card.topic, format: card.format, hook: card.hook, ...(card.topicId ? { topicId: card.topicId } : {}), ...(card.source === "fresh" && card.health ? { health: true } : {}) }
      : t ? { topic: t } : {};
    const r = await callAction(() => writeReelScriptAction(input));
    if (r.ok) { router.push(`/reels/${r.reelId}`); return; } // stays "busy" until the review page arrives
    setBusy(false);
    setError(r.error);
  };

  // the picked card stays on the list when "More ideas" brings a new batch
  const list = picked && !ideas.some((i) => i.topic === picked.topic) ? [picked, ...ideas] : ideas;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel title="New reel">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void write(); }}>
          <div className="space-y-2">
            <Label htmlFor="reel-topic" className="text-sm font-semibold text-ink">Topic <span className="font-normal text-muted">(optional)</span></Label>
            <Input id="reel-topic" value={topic} maxLength={TOPIC_MAX} disabled={busy} autoComplete="off"
              placeholder="e.g. why toddlers say no" onChange={(e) => type(e.target.value)} />
            <p className="text-xs text-muted">Leave it blank and the AI picks a proven parenting topic you haven&apos;t used lately, in the next of the 5 story formats. Or tap <strong className="font-semibold">Suggest topics</strong> to see 5 quick ideas first.</p>
          </div>

          <div className="space-y-3">
            {!list.length && (
              <Button variant="subtle" onClick={() => void suggest()} loading={suggesting} disabled={busy} className="w-full sm:w-auto">
                {!suggesting && <Lightbulb className="size-4" aria-hidden />} Suggest topics
              </Button>
            )}
            {suggesting && (
              <div role="status" aria-live="polite" className="space-y-2">
                <p className="text-xs font-semibold text-muted">Finding fresh topics… a few seconds</p>
                {!list.length && [0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
              </div>
            )}
            {suggestError && <p role="alert" className="text-xs font-medium text-bad">{suggestError}</p>}
            {list.length > 0 && (
              <>
                <p className="text-xs text-muted">Tap a topic to use it. You can still edit the words above.</p>
                <ul aria-label="Topic ideas" className={cn("grid gap-2", suggesting && "opacity-60")}>
                  {list.map((idea) => (
                    <li key={idea.topic}>
                      <IdeaCard idea={idea} on={picked?.topic === idea.topic} disabled={busy} onPick={() => pick(idea)} />
                    </li>
                  ))}
                </ul>
                <Button variant="ghost" size="sm" onClick={() => void suggest()} loading={suggesting} disabled={busy}>
                  {!suggesting && <RefreshCw className="size-4" aria-hidden />} More ideas
                </Button>
              </>
            )}
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
              {busy ? "Writing script…" : error ? "Try again" : picked ? "Write script for this topic" : "Write script"}
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
            ["Pick", "Type a topic, leave it blank, or tap Suggest topics for 5 quick ideas with their opening line."],
            ["Write", "The AI writes a 60–90 second lesson: about 20–30 short lines, one picture each, with a fresh hook every few seconds."],
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
