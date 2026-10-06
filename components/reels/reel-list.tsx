"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Clapperboard, DatabaseZap, Plus } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ReelListItem, ReelListScene } from "@/lib/data/reels";
import type { ReelRow } from "@/lib/db/types";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { FadeImage } from "@/components/ui/fade-image";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import { createClient, realtimeAuthReady } from "@/lib/supabase/client";
import { clock, imageCounts, isWorking, reelProgress } from "@/lib/reels/status";

export const SETUP_TEXT = "Run supabase/migrations/005_reels.sql in Supabase to turn on Reels.";

/** Shown on every Reels page while the database doesn't have the reels tables yet. */
export function ReelsSetup() {
  return <Empty icon={<DatabaseZap className="size-6" />} title="Reels need one setup step" text={SETUP_TEXT} />;
}

export const newReelLink = "inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-accent-ink shadow-soft transition hover:opacity-90 active:scale-[.98]";

/** Status badge for a reel (pulses while the PC works on it). */
export function ReelBadge({ reel, scenes, music = false }: { reel: Pick<ReelRow, "status" | "voice_path" | "words" | "music_path">; scenes: { status: ReelListScene["status"] }[]; music?: boolean }) {
  const p = reelProgress(reel, scenes, music);
  return <Badge tone={p.tone} pulse={reel.status !== "queued" && isWorking(reel.status)}>{p.label}</Badge>;
}

const LIST_SELECT = "*, reel_scenes(id, position, status, photo_path)";
const toItems = (data: unknown[]): ReelListItem[] => data.map((r) => {
  const { reel_scenes, ...rest } = r as ReelRow & { reel_scenes: ReelListScene[] | null };
  return { ...rest, scenes: [...(reel_scenes ?? [])].sort((a, b) => a.position - b.position) };
});

const DEBOUNCE_MS = 500;
const MAX_WAIT_MS = 3000;
/** Debounced reload with a max wait: a steady stream of image updates still reloads every ~3 s. */
export const nextLoadDelay = (sinceFirstKick: number) => Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - sinceFirstKick));

/** The list stays live: any reel or image change reloads it (debounced), so badges move on their own. */
function useLiveReels(initial: ReelListItem[]) {
  const [rows, setRows] = useState(initial);
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) { setSeed(initial); setRows(initial); }
  useEffect(() => {
    const sb = createClient();
    let t: ReturnType<typeof setTimeout> | undefined;
    let gone = false;
    let ch: RealtimeChannel | null = null;
    const load = async () => {
      try {
        const { data, error } = await sb.from("reels").select(LIST_SELECT).order("created_at", { ascending: false }).limit(60);
        if (!error && data && !gone) setRows(toItems(data));
      } catch { /* keep what we have */ }
    };
    let firstKick = 0;
    const kick = () => {
      const now = Date.now();
      if (!t) firstKick = now;
      clearTimeout(t);
      t = setTimeout(() => { t = undefined; void load(); }, nextLoadDelay(now - firstKick));
    };
    void realtimeAuthReady(sb).then(() => {
      if (gone) return;
      ch = sb.channel(`reels-list:${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "reels" }, kick)
        .on("postgres_changes", { event: "*", schema: "public", table: "reel_scenes" }, kick)
        .subscribe((s) => { if (s === "SUBSCRIBED") kick(); });
    });
    const onVisible = () => { if (document.visibilityState === "visible") kick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
      if (ch) void sb.removeChannel(ch);
    };
  }, []);
  return rows;
}

const dateText = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function ReelList({ reels: initial, music = false }: { reels: ReelListItem[]; music?: boolean }) {
  const reels = useLiveReels(initial);
  const thumbs = reels.map((r) => r.scenes.find((s) => s.status === "done" && s.photo_path)?.photo_path ?? null);
  const urlFor = useSignedUrls(thumbs, "reels");

  if (!reels.length) {
    return <Empty icon={<Clapperboard className="size-6" />} title="No reels yet"
      text="Write a script with Gemini, check it, and your PC makes the narrated video."
      action={<Link href="/reels/new" className={newReelLink}><Plus className="size-4" /> New reel</Link>} />;
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {reels.map((r, i) => {
        const p = reelProgress(r, r.scenes, music);
        const { total } = imageCounts(r.scenes);
        const working = isWorking(r.status);
        return (
          <li key={r.id}>
            <Link href={`/reels/${r.id}`}
              className="flex gap-3 rounded-2xl border border-line bg-surface p-3 shadow-soft transition hover:border-accent/40 focus-visible:outline-2 focus-visible:outline-accent">
              <div className="relative aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-lg bg-surface-2 sm:w-[72px]">
                {thumbs[i] ? <FadeImage src={urlFor(thumbs[i])} />
                  : <div className="grid size-full place-items-center text-muted"><Clapperboard className="size-5" aria-hidden /></div>}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="line-clamp-2 font-semibold leading-snug text-ink">{r.title}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {dateText(r.created_at)} · {total} images{r.duration_s ? ` · ${clock(r.duration_s)}` : ""}{r.stage ? ` · ${r.stage}` : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-2 pt-2">
                  <ReelBadge reel={r} scenes={r.scenes} music={music} />
                  {working && (
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${p.pct}%` }} />
                    </div>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
