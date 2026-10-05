import { notFound } from "next/navigation";
import { getReel } from "@/lib/data/reels";
import { ReelDetail } from "@/components/reels/reel-detail";
import { ReelsSetup } from "@/components/reels/reel-list";
import { PageHeader } from "@/components/ui/page-header";

// "New script" (Gemini) runs on this route and can take a few minutes.
export const maxDuration = 300;

export default async function ReelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getReel(id);
  if (!data) notFound();
  if (data.setup) return <><PageHeader title="Reels" /><ReelsSetup /></>;
  return <ReelDetail key={id} reel={data.reel} scenes={data.scenes} />;
}
