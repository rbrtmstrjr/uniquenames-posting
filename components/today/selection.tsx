"use client";
import { createContext, useContext, useState } from "react";
import type { Gender, NameStyle } from "@/lib/db/types";

// The gender + name style picked in New post, shared with the Stock card on Today so it can
// highlight the matching count. Without a provider (tests, other pages) each user keeps its own.
export type TodaySelection = { gender: Gender; style: NameStyle };
type Pair = [TodaySelection, (s: TodaySelection) => void];

const DEFAULT: TodaySelection = { gender: "boy", style: "two-word" };
const Ctx = createContext<Pair | null>(null);

export function TodaySelectionProvider({ children }: { children: React.ReactNode }) {
  const pair = useState<TodaySelection>(DEFAULT);
  return <Ctx.Provider value={pair}>{children}</Ctx.Provider>;
}

export function useTodaySelection(): Pair {
  const shared = useContext(Ctx);
  const local = useState<TodaySelection>(DEFAULT);
  return shared ?? local;
}
