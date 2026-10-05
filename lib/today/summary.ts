import type { Gender, NameStyle } from "@/lib/db/types";
import type { AgeChoice } from "@/lib/planner/age";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const ageText = (age: AgeChoice) =>
  age === "random" ? "Random ages" : age === "newborn" ? "Newborn" : age === "1" ? "1 year old" : `${age} years old`;

/** The Today footer line: "10 cards · Boy · Two-word · Random ages · Modern Realism" ("Auto" → "6–15 cards"). */
export function postSummary({ count, min, max, gender, style, age, themeTitle }: {
  count: string; min: number; max: number; gender: Gender; style: NameStyle; age: AgeChoice; themeTitle?: string;
}) {
  const cards = count === "auto" ? `${min}–${max} cards` : `${count} cards`;
  return [cards, cap(gender), cap(style), ageText(age), themeTitle].filter(Boolean).join(" · ");
}

/** Names left for one gender + style: none, low (under 15 or under the biggest post), or fine. */
export type StockLevel = "out" | "low" | "ok";
export const LOW_STOCK = 15;
export const stockLevel = (count: number, maxCards: number): StockLevel =>
  count <= 0 ? "out" : count < Math.max(LOW_STOCK, maxCards) ? "low" : "ok";

/** About how many more posts a stock of names covers, at the average Auto post size. */
export const postsLeft = (count: number, minCards: number, maxCards: number): number =>
  Math.floor(Math.max(0, count) / Math.max(1, Math.round((minCards + maxCards) / 2)));
