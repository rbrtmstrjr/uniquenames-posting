import { createClient } from "@/lib/supabase/server";
import type { NameRow } from "@/lib/db/types";
import { NamesTable } from "@/components/names/names-table";
import { PageHeader } from "@/components/ui/page-header";

const PAGE = 1000; // PostgREST's default max-rows

export default async function NamesPage() {
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
      <NamesTable names={names} />
    </>
  );
}
