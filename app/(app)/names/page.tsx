import { createClient } from "@/lib/supabase/server";
import type { NameRow } from "@/lib/db/types";
import { NamesTable } from "@/components/names/names-table";
import { namesFilterFromParams } from "@/lib/names/filter";
import { PageHeader } from "@/components/ui/page-header";

const PAGE = 1000; // PostgREST's default max-rows

// "Suggest with AI" server actions run on this route and can wait ~50 s for Gemini.
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
  return (
    <>
      <PageHeader title="Names" subtitle="The names and meanings your posts use. Exact spelling here is exactly what goes on the card." />
      <NamesTable names={names} initial={initial} />
    </>
  );
}
