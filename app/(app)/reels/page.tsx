import Link from "next/link";
import { Plus } from "lucide-react";
import { getReelList } from "@/lib/data/reels";
import { musicOn } from "@/lib/data/voices";
import { ReelList, ReelsSetup } from "@/components/reels/reel-list";
import { newReelLink } from "@/components/reels/styles";
import { PageHeader } from "@/components/ui/page-header";

// Server actions run with the page's limit: writing a script can take a few minutes.
export const maxDuration = 300;

export default async function ReelsPage() {
  const [data, music] = await Promise.all([getReelList(), musicOn().catch(() => false)]);
  return (
    <>
      <PageHeader title="Reels" subtitle="Narrated knitted-doll videos. Write a script, check it, and your PC makes the reel."
        action={data.setup ? undefined : <Link href="/reels/new" className={newReelLink}><Plus className="size-4" aria-hidden /> New reel</Link>} />
      {data.setup ? <ReelsSetup /> : <ReelList reels={data.reels} music={music} />}
    </>
  );
}
