"use client";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { SwapName } from "@/lib/actions/swap-name";
import { cn } from "@/lib/utils/cn";
import { MyNames } from "./my-names";
import { NameIdeas } from "./name-ideas";

type Tab = "mine" | "ai";
const TABS: { id: Tab; label: string }[] = [{ id: "mine", label: "My names" }, { id: "ai", label: "AI ideas" }];

/**
 * A different name for a card: "My names" (names from the Names page that fit the post) or "AI ideas" (Gemini).
 * My names opens first; when no name fits (or the list can't load) the dialog shows AI ideas instead, unless the
 * owner already chose a tab. Both panels stay mounted, so switching keeps the list and the ideas.
 */
export function NamePicker({ cardId, current, pickedId, onPickMine, onPickIdea, refreshKey }: {
  cardId: string; current: string; pickedId: string | null;
  onPickMine: (n: SwapName) => void; onPickIdea: (idea: { name: string; meaning: string }) => void; refreshKey?: number;
}) {
  const [tab, setTab] = useState<Tab>("mine");
  const chosen = useRef(false);
  const id = useId();
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ mine: null, ai: null });

  const choose = (t: Tab) => { chosen.current = true; setTab(t); };
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const to = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length]
      : e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[TABS.length - 1] : null;
    if (!to) return;
    e.preventDefault();
    choose(to.id);
    refs.current[to.id]?.focus();
  };

  return (
    <div className="rounded-xl border border-line p-3">
      <div role="tablist" aria-label="Pick a different name" onKeyDown={onKey} className="mb-3 flex h-11 rounded-xl bg-surface-2 p-1">
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" role="tab" id={`${id}-${t.id}-tab`}
              aria-selected={on} aria-controls={`${id}-${t.id}`} tabIndex={on ? 0 : -1} onClick={() => choose(t.id)}
              className={cn("flex-1 rounded-lg text-sm font-semibold transition",
                on ? "bg-accent text-accent-ink shadow-soft" : "text-muted hover:text-ink")}>
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${id}-mine`} aria-labelledby={`${id}-mine-tab`} hidden={tab !== "mine"}>
        <MyNames cardId={cardId} pickedId={pickedId} onPick={onPickMine} refreshKey={refreshKey}
          onFirstLoad={(n) => { if (!n && !chosen.current) setTab("ai"); }} />
      </div>
      <div role="tabpanel" id={`${id}-ai`} aria-labelledby={`${id}-ai-tab`} hidden={tab !== "ai"}>
        <NameIdeas cardId={cardId} current={current} onPick={onPickIdea} bare />
      </div>
    </div>
  );
}
