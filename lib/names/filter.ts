// Names page filters, shared by the server page (reads the URL) and the client table.
import type { Gender, NameStatus, NameStyle } from "@/lib/db/types";
import { AZ_LETTERS } from "@/lib/series/az";

export interface NamesFilter { gender?: Gender; style?: NameStyle; status?: NameStatus | "all"; letter?: string }
export const NAME_STATUSES: (NameStatus | "all")[] = ["available", "reserved", "used", "skip", "pending", "all"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The Names page filters from its URL (?status=&gender=&style=&letter=); anything unknown is ignored. */
export function namesFilterFromParams(p: Record<string, string | string[] | undefined>): NamesFilter {
  const gender = one(p.gender), style = one(p.style), status = one(p.status), letter = one(p.letter)?.toUpperCase();
  return {
    gender: gender === "boy" || gender === "girl" ? gender : undefined,
    style: style === "single" || style === "two-word" ? style : undefined,
    status: NAME_STATUSES.includes(status as NameStatus) ? (status as NameStatus | "all") : undefined,
    letter: letter && AZ_LETTERS.includes(letter) ? letter : undefined,
  };
}
