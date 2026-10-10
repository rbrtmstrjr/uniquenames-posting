"use client";
import { useEffect } from "react";
import { BottomTabs, SideNav } from "./nav";
import { ActivityPill } from "./activity-pill";
import { PcStatus } from "./pc-status";
import { ThemeToggle } from "./theme-toggle";
import { useActivity, useWorker } from "@/lib/realtime/hooks";
import { chime, notify } from "@/lib/realtime/chime";
import type { WorkerStatusRow } from "@/lib/db/types";
import { createContext, useContext } from "react";
import type { WorkerHealth } from "@/lib/status/worker-health";
import { brand } from "@/packs/shared";

const WorkerCtx = createContext<{ health: WorkerHealth; lastSeen: string; row: WorkerStatusRow | null; busyElsewhere?: boolean }>({ health: "unknown", lastSeen: "never", row: null });
export const useWorkerContext = () => useContext(WorkerCtx);

/** The pack's logo mark when it has one (Name Nest), else its glyph (Unique Names' ✿, as before). */
function BrandMark() {
  const { logo } = brand().assets;
  // eslint-disable-next-line @next/next/no-img-element -- a tiny static SVG from public/
  return logo ? <img src={logo} alt="" aria-hidden className="h-7 w-auto" /> : <span className="italic text-accent">{brand().mark}</span>;
}

export function AppShell({ initialWorker, soundOn, children }: { initialWorker: WorkerStatusRow | null; soundOn: boolean; children: React.ReactNode }) {
  const worker = useWorker(initialWorker);
  const activity = useActivity(() => {
    if (soundOn) chime();
    notify("Post ready", brand().postReadyText);
  });

  useEffect(() => {
    const base = brand().name;
    document.title = activity.post ? `(${activity.done}/${activity.total}) ${base}` : activity.finishedPostId ? `✓ ${base}` : base;
  }, [activity.post, activity.done, activity.total, activity.finishedPostId]);

  return (
    <WorkerCtx.Provider value={worker}>
      <div className="min-h-dvh bg-bg md:grid md:grid-cols-[232px_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line px-3 py-5 md:flex">
          <div className="mb-6 flex items-center gap-2 px-3 font-display text-xl text-ink"><BrandMark /> {brand().name}</div>
          <SideNav />
          <div className="mt-auto space-y-3 px-3">
            <PcStatus health={worker.health} lastSeen={worker.lastSeen} busyElsewhere={worker.busyElsewhere} />
            <ThemeToggle />
          </div>
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur md:justify-end md:px-8">
            <div className="flex items-center gap-1.5 font-display text-lg text-ink md:hidden"><BrandMark /> {brand().name}</div>
            <div className="flex items-center gap-3">
              <ActivityPill a={activity} />
              <div className="md:hidden"><PcStatus health={worker.health} lastSeen={worker.lastSeen} busyElsewhere={worker.busyElsewhere} compact /></div>
            </div>
          </header>
          <main className="w-full px-4 pb-28 pt-5 md:px-6 md:pb-12 xl:px-8 2xl:px-10">{children}</main>
        </div>
      </div>
      <BottomTabs />
    </WorkerCtx.Provider>
  );
}
