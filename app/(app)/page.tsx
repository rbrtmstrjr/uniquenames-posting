import { getTodayData } from "@/lib/data/today";
import { NewPostPanel } from "@/components/today/new-post-panel";
import { ActivePost } from "@/components/today/active-post";
import { Stock } from "@/components/today/stock";
import { TodaySelectionProvider } from "@/components/today/selection";
import { Empty } from "@/components/ui/empty";
import { ImageIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

// Create post waits on Gemini for the caption (9 s budget) plus a few DB round trips.
export const maxDuration = 60;

export default async function TodayPage() {
  const d = await getTodayData();
  const themesLeft = { boy: d.themes.filter((t) => t.gender === "boy").length, girl: d.themes.filter((t) => t.gender === "girl").length };
  return (
    <>
      <PageHeader title="Today" subtitle="Make today's post. Cards appear here as your PC finishes them." />
      {/* The Stock card highlights the gender + style picked in New post (shared selection). */}
      <TodaySelectionProvider>
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_300px]">
          <NewPostPanel settings={d.settings} themes={d.themes} stock={d.stock} busy={d.activePost?.status === "generating"} />
          {/* Top-aligned, and sticky under the header on desktop. */}
          <Stock stock={d.stock} themes={themesLeft} max={d.settings.max_images} className="lg:sticky lg:top-[4.5rem]" />
        </div>
      </TodaySelectionProvider>
      <div className="mt-4">
        {d.activePost
          ? <ActivePost key={d.activePost.id} post={d.activePost} initialCards={d.activeCards} />
          : <Empty icon={<ImageIcon className="size-6" />} title="No post in progress" text="Pick Boy or Girl above and press Generate post." />}
      </div>
    </>
  );
}
