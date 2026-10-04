import { getTodayData } from "@/lib/data/today";
import { NewPostPanel } from "@/components/today/new-post-panel";
import { ActivePost } from "@/components/today/active-post";
import { Stock } from "@/components/today/stock";
import { PageHeader } from "@/components/ui/page-header";

export default async function TodayPage() {
  const d = await getTodayData();
  const themesLeft = { boy: d.themes.filter((t) => t.gender === "boy").length, girl: d.themes.filter((t) => t.gender === "girl").length };
  return (
    <>
      <PageHeader title="Today" subtitle="Make today's post. Cards appear here as your PC finishes them." />
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <NewPostPanel settings={d.settings} themes={d.themes} stock={d.stock} busy={d.activePost?.status === "generating"} />
        <Stock stock={d.stock} themes={themesLeft} min={d.settings.min_images} />
      </div>
      {d.activePost && <div className="mt-4"><ActivePost key={d.activePost.id} post={d.activePost} initialCards={d.activeCards} /></div>}
    </>
  );
}
