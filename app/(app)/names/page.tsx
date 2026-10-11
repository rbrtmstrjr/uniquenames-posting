import { createClient } from "@/lib/supabase/server";
import type { ExportLogRow, NameRow } from "@/lib/db/types";
import { NamesTable } from "@/components/names/names-table";
import { ExportPdf } from "@/components/names/export-pdf";
import { PastExports } from "@/components/names/past-exports";
import { namesFilterFromParams } from "@/lib/names/filter";
import { PageHeader } from "@/components/ui/page-header";

const PAGE = 1000; // PostgREST's default max-rows

// "Suggest with AI" server actions run on this route and can wait ~50 s for Gemini; so do the names PDF's sorting rounds.
export const maxDuration = 60;

export default async function NamesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Links from Today's A–Z letters open a filtered view (e.g. ?status=pending&gender=boy&style=single&letter=Q).
  const initial = namesFilterFromParams(await searchParams);
  const sb = await createClient();
  const names: NameRow[] = [];
  // Page through the table: a single select is capped at 1000 rows server-side.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("names").select("*").order("name").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    names.push(...((data ?? []) as NameRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  // The names PDF log (migration 018); null = not there yet (the list says how to add it). Passwords are read on demand.
  const { data: log, error: logError } = await sb.from("exports").select("id, created_at, buyer, gender, name_count, file_name, pack")
    .order("created_at", { ascending: false }).limit(200);
  const exports = logError ? null : ((log ?? []) as ExportLogRow[]);
  // A select("*") row carries meaning_category once 018 ran (null = not sorted yet).
  const canSort = names.some((n) => "meaning_category" in n);
  return (
    <>
      <PageHeader title="Names" subtitle="The names and meanings your posts use. Exact spelling here is exactly what goes on the card." />
      <div className="space-y-4">
        <PastExports exports={exports} />
        <NamesTable names={names} initial={initial} toolbar={<ExportPdf names={names} canSort={canSort} />} />
      </div>
    </>
  );
}
