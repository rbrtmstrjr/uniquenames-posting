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

const WorkerCtx = createContext<{ health: WorkerHealth; lastSeen: string; row: WorkerStatusRow | null }>({ health: "unknown", lastSeen: "never", row: null });
export const useWorkerContext = () => useContext(WorkerCtx);

export function AppShell({ initialWorker, soundOn, children }: { initialWorker: WorkerStatusRow | null; soundOn: boolean; children: React.ReactNode }) {
  const worker = useWorker(initialWorker);
  const activity = useActivity(() => {
    if (soundOn) chime();
    notify("Post ready", "Your Unique Names cards are done.");
  });

  useEffect(() => {
    const base = "Unique Names";
    document.title = activity.post ? `(${activity.done}/${activity.total}) ${base}` : activity.finishedPostId ? `✓ ${base}` : base;
  }, [activity.post, activity.done, activity.total, activity.finishedPostId]);

  return (
    <WorkerCtx.Provider value={worker}>
      <div className="min-h-dvh bg-bg md:grid md:grid-cols-[232px_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line px-3 py-5 md:flex">
          <div className="mb-6 px-3 font-display text-xl text-ink"><span className="italic text-accent">✿</span> Unique Names</div>
          <SideNav />
          <div className="mt-auto space-y-3 px-3">
            <PcStatus health={worker.health} lastSeen={worker.lastSeen} />
            <ThemeToggle />
          </div>
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur md:justify-end md:px-8">
            <div className="font-display text-lg text-ink md:hidden"><span className="italic text-accent">✿</span> Unique Names</div>
            <div className="flex items-center gap-3">
              <ActivityPill a={activity} />
              <div className="md:hidden"><PcStatus health={worker.health} lastSeen={worker.lastSeen} compact /></div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 md:px-8 md:pb-12">{children}</main>
        </div>
      </div>
      <BottomTabs />
    </WorkerCtx.Provider>
  );
}
