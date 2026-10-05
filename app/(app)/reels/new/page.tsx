import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { reelsReady } from "@/lib/data/reels";
import { NewReelForm } from "@/components/reels/new-reel-form";
import { ReelsSetup } from "@/components/reels/reel-list";
import { PageHeader } from "@/components/ui/page-header";

// "Write script" runs here: Gemini plus up to 2 rewrites can take a few minutes.
export const maxDuration = 300;

export default async function NewReelPage() {
  const ready = await reelsReady();
  return (
    <>
      <Link href="/reels" className="mb-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="size-4" /> Reels</Link>
      <PageHeader title="New reel" subtitle="Gemini writes the script. You check it before anything is made." />
      {ready ? <NewReelForm /> : <ReelsSetup />}
    </>
  );
}
