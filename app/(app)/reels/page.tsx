import Link from "next/link";
import { Plus } from "lucide-react";
import { getReelList } from "@/lib/data/reels";
import { ReelList, ReelsSetup, newReelLink } from "@/components/reels/reel-list";
import { PageHeader } from "@/components/ui/page-header";

// Server actions run with the page's limit: writing a script can take a few minutes.
export const maxDuration = 300;

export default async function ReelsPage() {
  const data = await getReelList();
  return (
    <>
      <PageHeader title="Reels" subtitle="Narrated knitted-doll videos. Write a script, check it, and your PC makes the reel."
        action={data.setup ? undefined : <Link href="/reels/new" className={newReelLink}><Plus className="size-4" aria-hidden /> New reel</Link>} />
      {data.setup ? <ReelsSetup /> : <ReelList reels={data.reels} />}
    </>
  );
}
