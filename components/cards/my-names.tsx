"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/shadcn/input";
import { listSwapNamesAction, type SwapName } from "@/lib/actions/swap-name";
import { callAction } from "@/lib/actions/call";
import { cn } from "@/lib/utils/cn";

const DEBOUNCE_MS = 300;

/**
 * "My names" in the card dialog: the available names from the Names page that fit this card's post (same gender and
 * style, the post's letter, none already on the post), 20 at a time, searchable by name or meaning. Tapping one fills
 * the Name and Meaning fields; Save text then puts it on the card (the old name goes back to the Names page).
 * `refreshKey` reloads the list (after a name was just taken). `onFirstLoad` reports how many fit, once.
 */
export function MyNames({ cardId, pickedId, onPick, refreshKey = 0, onFirstLoad }: {
  cardId: string; pickedId: string | null; onPick: (n: SwapName) => void; refreshKey?: number; onFirstLoad?: (count: number) => void;
}) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [names, setNames] = useState<SwapName[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The list shown belongs to `shownKey`; while it differs from the wanted key the list is loading.
  const key = `${cardId}|${query}|${refreshKey}`;
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loading = shownKey !== key ? "list" : loadingMore ? "more" : null;
  const seq = useRef(0);
  const reported = useRef(false);
  const report = useEffectEvent((count: number) => onFirstLoad?.(count));

  // Search after a short pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const mine = ++seq.current;
    void callAction(() => listSwapNamesAction(cardId, query ? { q: query } : {})).then((r) => {
      if (mine !== seq.current) return;
      setShownKey(`${cardId}|${query}|${refreshKey}`);
      setLoadingMore(false);
      if (!r.ok) { setError(r.error); setNames([]); setNext(null); }
      else { setError(null); setNames(r.names); setNext(r.next); }
      if (!reported.current && !query) { reported.current = true; report(r.ok ? r.names.length : 0); }
    });
  }, [cardId, query, refreshKey]);

  const more = async () => {
    if (next === null) return;
    const mine = ++seq.current;
    setLoadingMore(true);
    const r = await callAction(() => listSwapNamesAction(cardId, { ...(query ? { q: query } : {}), cursor: next }));
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setNames((have) => [...have, ...r.names.filter((n) => !have.some((h) => h.id === n.id))]);
    setNext(r.next);
  };

  return (
    <div className="space-y-2">
      <label className="relative block">
        <span className="sr-only">Search your names</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or meaning" className="pl-9" maxLength={60} />
      </label>
      {loading === "list" && !names.length && <p className="text-xs text-muted" aria-live="polite">Loading your names…</p>}
      {error && <p role="alert" className="text-xs font-medium text-bad">{error}</p>}
      {!loading && !error && !names.length && (
        <p className="text-xs text-muted">
          {query ? `No names match "${query}".` : "No unused names fit this card."}{" "}
          <Link href="/names" className="font-semibold text-accent underline-offset-2 hover:underline">Add names on the Names page</Link>
        </p>
      )}
      {names.length > 0 && (
        <ul aria-label="Your names" className={cn("grid max-h-72 gap-1.5 overflow-y-auto overscroll-contain", loading === "list" && "opacity-60")}>
          {names.map((n) => {
            const on = n.id === pickedId;
            return (
              <li key={n.id}>
                <button type="button" onClick={() => onPick(n)} aria-pressed={on}
                  className={cn("flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                    on ? "bg-accent-soft ring-1 ring-accent/50" : "bg-surface-2 hover:bg-accent-soft")}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{n.name}</span>
                    <span className="block text-xs text-muted">{n.meaning}</span>
                    {n.detail && <span className="block text-xs text-muted">{n.detail}</span>}
                    {/* A post by initials (017) also offers names used on earlier posts, after the unused ones. */}
                    {n.usedBefore && <span className="mt-1 inline-block rounded-md bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold text-warn-text">used before</span>}
                  </span>
                  {on && <Check className="size-4 shrink-0 text-accent" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {next !== null && (
        <Button size="sm" variant="ghost" onClick={more} loading={loading === "more"} disabled={loading !== null} className="w-full">Show more</Button>
      )}
    </div>
  );
}
