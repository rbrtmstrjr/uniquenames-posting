// The US Social Security Administration's national baby-name data (public domain): names.zip holds one file per year,
// yobYYYY.txt, with lines "Name,F|M,count" sorted by count (highest first) per sex. Pure helpers for
// scripts/import-ssa.ts (tested in tests/ssa-import.test.ts).
import JSZip from "jszip";
import type { Gender } from "@/lib/db/types";

export const SSA_URL = "https://www.ssa.gov/oact/babynames/names.zip";

export interface SsaName { name: string; gender: Gender; style: "single"; us_rank: number; us_year: number }
interface Row { name: string; count: number; rank: number }

/** The latest yobYYYY.txt in the zip: { year, text }. */
export async function latestYear(zipBytes: ArrayBuffer | Uint8Array): Promise<{ year: number; text: string }> {
  const zip = await JSZip.loadAsync(zipBytes);
  const years = Object.keys(zip.files).map((f) => /^yob(\d{4})\.txt$/i.exec(f.split("/").pop() ?? "")).filter(Boolean)
    .map((m) => ({ year: Number(m![1]), file: m![0] }));
  if (!years.length) throw new Error("names.zip has no yobYYYY.txt files");
  const best = years.reduce((a, b) => (b.year > a.year ? b : a));
  const file = Object.keys(zip.files).find((f) => f.split("/").pop() === best.file)!;
  return { year: best.year, text: await zip.file(file)!.async("string") };
}

/** One year's file: girls and boys in SSA order, ranked 1.. within each sex (the file's order is the ranking). */
export function parseYear(text: string): { girl: Row[]; boy: Row[] } {
  const out: { girl: Row[]; boy: Row[] } = { girl: [], boy: [] };
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z]+),([FM]),(\d+)$/.exec(line.trim());
    if (!m) continue;
    const list = m[2] === "F" ? out.girl : out.boy;
    list.push({ name: m[1], count: Number(m[3]), rank: list.length + 1 });
  }
  return out;
}

/**
 * The top `top` names per gender, each name once (names.name is unique in any case): a name in both lists goes to
 * the gender that gave it more often, and that gender's list is topped up with the next names. Ranks are the SSA ranks.
 */
export function pickTop(rows: { girl: Row[]; boy: Row[] }, year: number, top = 500): SsaName[] {
  const countOf = (list: Row[]) => new Map(list.map((r) => [r.name.toLowerCase(), r.count]));
  const girls = countOf(rows.girl), boys = countOf(rows.boy);
  const owner = (name: string): Gender => ((girls.get(name) ?? 0) >= (boys.get(name) ?? 0) ? "girl" : "boy");
  const out: SsaName[] = [];
  for (const gender of ["girl", "boy"] as const) {
    let n = 0;
    for (const r of rows[gender]) {
      if (n >= top) break;
      if (owner(r.name.toLowerCase()) !== gender) continue;
      out.push({ name: r.name, gender, style: "single", us_rank: r.rank, us_year: year });
      n++;
    }
  }
  return out;
}
