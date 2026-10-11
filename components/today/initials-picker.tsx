"use client";
import { useEffect, useRef, useState } from "react";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { planInitialsAction, type InitialsPlanResult } from "@/lib/actions/initials";
import { callAction } from "@/lib/actions/call";
import type { Gender } from "@/lib/db/types";
import { firstInitialCounts, initialsText, secondInitialCounts, SOURCE_LABEL, type InitialsSource } from "@/lib/series/initials";
import { cn } from "@/lib/utils/cn";
import { LetterTiles } from "./letter-tiles";

export type InitialsPlan = Extract<InitialsPlanResult, { ok: true }>;

/** The request a plan answers: one gender, two initials, a card count (null = Auto) and a date. */
export interface PlanRequest { gender: Gender; first: string | null; second: string | null; count: number | null; postDate: string }

/**
 * The plan preview behind Today > Initials: asks the server for the names once both initials are picked (and again
 * when the gender, an initial, the count or the date changes; the AI names already shown are kept when only the count
 * or date changes). `shuffle` asks for new AI names, never the ones shown. `requestId` is fixed per plan, so a double
 * press on Generate makes one post.
 */
export function useInitialsPlan(req: PlanRequest & { enabled: boolean }) {
  const { enabled, gender, first, second, count, postDate } = req;
  const key = enabled && first && second ? `${gender}|${first}${second}|${count ?? "auto"}|${postDate}` : null;
  const [state, setState] = useState<{ key: string; plan: InitialsPlan | null; error: string | null; requestId: string } | null>(null);
  const [shuffling, setShuffling] = useState(false);
  // Fresh names shown for this gender + initials (kept when only the count changes) and the ones Shuffle skipped.
  const shown = useRef<{ pair: string; plan: InitialsPlan | null; skip: string[] }>({ pair: "", plan: null, skip: [] });
  const seq = useRef(0);

  const ask = async (k: string, extra: { keep?: InitialsPlan["fresh"]; skip?: string[] }) => {
    const mine = ++seq.current;
    const r = await callAction(() => planInitialsAction({ gender, first: first!, second: second!, count, postDate, ...extra }));
    if (mine !== seq.current) return;
    if (r.ok) shown.current = { ...shown.current, plan: r };
    setState({ key: k, plan: r.ok ? r : null, error: r.ok ? null : r.error, requestId: crypto.randomUUID() });
  };

  useEffect(() => {
    if (!key) return;
    const pair = `${gender}|${first}${second}`;
    if (shown.current.pair !== pair) shown.current = { pair, plan: null, skip: [] };
    const keep = shown.current.plan?.fresh;
    // A short pause so tapping through letters doesn't plan every tile.
    const t = setTimeout(() => { void ask(key, { keep, skip: shown.current.skip }); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers gender, initials, count and date
  }, [key]);

  const shuffle = async () => {
    if (!key) return;
    const skip = [...shown.current.skip, ...(shown.current.plan?.fresh.map((f) => f.name) ?? [])].slice(-120);
    shown.current = { ...shown.current, plan: null, skip };
    setShuffling(true);
    await ask(key, { skip });
    setShuffling(false);
  };

  const current = state && state.key === key ? state : null;
  return { plan: current?.plan ?? null, error: current?.error ?? null, requestId: current?.requestId ?? null, loading: !!key && !current, shuffling, shuffle };
}

const TONE: Record<InitialsSource, "ok" | "accent" | "muted"> = { available: "ok", new: "accent", used: "muted" };

/**
 * Today > Initials: two rows of letter tiles (the first name's initial, then the middle name's), then the plan: how many
 * names come from each source ("3 unused · 7 new AI · 0 reused") and which, with Shuffle for new AI names.
 */
export function InitialsPicker({ gender, pairs, need, first, second, onFirst, onSecond, plan, loading, error, shuffling, onShuffle }: {
  gender: Gender;
  /** Available two-word names of this gender per pair of initials ("AR": 3). */
  pairs: Record<string, number>;
  /** Cards this post needs (the chosen count, or the minimum for Auto). */
  need: number;
  first: string | null; second: string | null; onFirst: (l: string) => void; onSecond: (l: string) => void;
  plan: InitialsPlan | null; loading: boolean; error: string | null; shuffling: boolean; onShuffle: () => void;
}) {
  const firstCounts = firstInitialCounts(pairs);
  const secondCounts = secondInitialCounts(pairs, first);
  const unused = (l: string, n: number) => `${l}: ${n} unused`;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="block text-sm font-semibold text-ink">First name starts with</span>
        <LetterTiles label={`First initial for ${gender} names`} counts={firstCounts} need={1} value={first} onChange={onFirst} describe={unused} />
      </div>
      <div className="space-y-2">
        <span className="block text-sm font-semibold text-ink">Middle name starts with</span>
        <LetterTiles label={`Middle initial for ${gender} names`} counts={secondCounts} need={need} value={second} onChange={onSecond}
          describe={(l, n) => (first ? `${first}·${l}: ${n} unused` : unused(l, n))} />
      </div>
      {!first || !second ? (
        <p className="text-xs text-muted">Pick both initials. Unused names come first, then new AI names, then names used before. Green = enough unused names.</p>
      ) : (
        <section aria-label={`Names for ${initialsText(first + second)}`} aria-busy={loading || shuffling} className="space-y-2.5 rounded-xl bg-surface-2 px-3.5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p data-testid="initials-summary" className="text-sm font-semibold text-ink" aria-live="polite">
              {loading || shuffling ? `Planning ${initialsText(first + second)} names…` : plan ? plan.summary : "No plan yet"}
            </p>
            <Button variant="ghost" size="sm" onClick={onShuffle} loading={shuffling} disabled={loading || shuffling || !plan || plan.counts.new === 0 && plan.short === 0}
              title="Ask the AI for other new names">
              <Shuffle className="size-4" aria-hidden /> Shuffle
            </Button>
          </div>
          {error && <p role="alert" className="text-xs font-medium text-bad">{error}</p>}
          {plan?.aiNote && <p className="text-xs font-medium text-warn-text">{plan.aiNote}</p>}
          {plan && plan.short > 0 && (
            <p className="text-xs font-semibold text-warn-text">
              Only {plan.names.length} of {plan.want} names: the post will have {plan.names.length} card{plan.names.length === 1 ? "" : "s"}.
            </p>
          )}
          {plan && !plan.reuse && <p className="text-xs text-muted">Run migration 017 to also reuse names used before.</p>}
          {plan && plan.names.length > 0 && (
            <ul aria-label="Planned names" className={cn("grid max-h-64 gap-1 overflow-y-auto overscroll-contain", (loading || shuffling) && "opacity-60")}>
              {plan.names.map((n) => (
                <li key={n.name} className="flex items-start justify-between gap-2 rounded-lg bg-surface px-2.5 py-1.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{n.name}</span>
                    <span className="block text-xs text-muted">{n.meaning}</span>
                    {/* A fresh AI name: the two parts' standard meanings its card meaning is built from. */}
                    {n.parts && <span className="block text-[11px] text-muted/80">{n.name.split(" ")[0]}: {n.parts[0]} · {n.name.split(" ")[1]}: {n.parts[1]}</span>}
                  </span>
                  <Badge tone={TONE[n.source]} className="shrink-0">{SOURCE_LABEL[n.source]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
