import type { NameRow } from "@/lib/db/types";

/** "#38 in the US (2025) · Greek" for a name with a US rank and / or an origin (Name Nest, migration 015), else null. */
export function nameDetail(n: Pick<NameRow, "us_rank" | "us_year" | "origin">): string | null {
  const parts: string[] = [];
  if (typeof n.us_rank === "number" && n.us_rank > 0) parts.push(`#${n.us_rank} in the US${n.us_year ? ` (${n.us_year})` : ""}`);
  const origin = (n.origin ?? "").trim();
  if (origin) parts.push(origin);
  return parts.length ? parts.join(" · ") : null;
}
