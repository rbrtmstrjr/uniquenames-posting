"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { ReelRow, ReelSceneRow } from "@/lib/db/types";
import type { Narrator } from "@/lib/data/voices";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeRows } from "@/lib/realtime/use-table";
import { ScriptReview } from "./script-review";
import { ReelProgress } from "./reel-progress";

const byPosition = (a: ReelSceneRow, b: ReelSceneRow) => a.position - b.position;

/** /reels/[id]: the reel and its images stay live; `script` shows the review, anything later the progress. */
export function ReelDetail({ reel: initialReel, scenes: initialScenes, narrator = null }: { reel: ReelRow; scenes: ReelSceneRow[]; narrator?: Narrator | null }) {
  const id = initialReel.id;
  const reelSeed = useMemo(() => [initialReel], [initialReel]);
  const refetchReel = useCallback(async () => {
    const { data, error } = await createClient().from("reels").select("*").eq("id", id);
    return error ? null : ((data ?? []) as ReelRow[]);
  }, [id]);
  const refetchScenes = useCallback(async () => {
    const { data, error } = await createClient().from("reel_scenes").select("*").eq("reel_id", id).order("position");
    return error ? null : ((data ?? []) as ReelSceneRow[]);
  }, [id]);
  const [reels, setReels] = useRealtimeRows<ReelRow>("reels", reelSeed, { key: `reel-${id}`, filter: `id=eq.${id}`, refetch: refetchReel });
  const [scenes, setScenes] = useRealtimeRows<ReelSceneRow>("reel_scenes", initialScenes, { key: `reel-scenes-${id}`, filter: `reel_id=eq.${id}`, sort: byPosition, refetch: refetchScenes });
  const reel = reels[0] ?? initialReel;
  const router = useRouter();
  // Deleted elsewhere (another tab or phone): realtime empties the row -> back to the list.
  const gone = reels.length === 0;
  useEffect(() => { if (gone) router.replace("/reels"); }, [gone, router]);

  const patchReel = (p: Partial<ReelRow>) => setReels((prev) => prev.map((r) => ({ ...r, ...p })));
  const patchScene = (sid: string, p: Partial<ReelSceneRow>) => setScenes((prev) => prev.map((s) => (s.id === sid ? { ...s, ...p } : s)));

  return (
    <div className="space-y-2">
      <Link href="/reels" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="size-4" /> Reels</Link>
      {reel.status === "script"
        ? <ScriptReview reel={reel} scenes={scenes} narrator={narrator}
            onApproved={() => { patchReel({ status: "queued" }); setScenes((prev) => prev.map((s) => (s.status === "pending" ? { ...s, status: "queued" } : s))); }} />
        : <ReelProgress reel={reel} scenes={scenes} onPatchReel={patchReel} onPatchScene={patchScene} />}
    </div>
  );
}
