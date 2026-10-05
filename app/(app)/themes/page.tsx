import { createClient } from "@/lib/supabase/server";
import type { CardRow, ThemeRow } from "@/lib/db/types";
import { ThemeList } from "@/components/themes/theme-list";
import { PageHeader } from "@/components/ui/page-header";

// "Suggest with AI" server actions run on this route and can wait ~50 s for Gemini.
export const maxDuration = 60;

export default async function ThemesPage() {
  const sb = await createClient();
  const [{ data: themes }, { data: previews }] = await Promise.all([
    sb.from("themes").select("*").order("sort_order"),
    sb.from("cards").select("*").eq("kind", "preview"),
  ]);
  return (
    <>
      <PageHeader title="Themes" subtitle="One photoshoot per post, used once. Drag to choose what comes next; make a preview to see the look first." />
      <ThemeList themes={(themes ?? []) as ThemeRow[]} previews={(previews ?? []) as CardRow[]} />
    </>
  );
}
