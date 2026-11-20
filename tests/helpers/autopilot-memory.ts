import type { AutopilotItemRow, AutopilotRunRow, CardRow, Gender, SettingsRow } from "@/lib/db/types";
import type { WorkerHealth } from "@/lib/status/worker-health";
import type { AutopilotRepo, RepoName, TickPatch } from "@/lib/autopilot/repo";

/** An in-memory AutopilotRepo: plain arrays the tests set up and read back. */
export function memoryRepo(o: {
  runs?: AutopilotRunRow[]; items?: AutopilotItemRow[]; cards?: CardRow[]; names?: RepoName[];
  health?: WorkerHealth; themesLeft?: Partial<Record<Gender, number>>; settings?: Partial<SettingsRow>;
} = {}) {
  const db = {
    runs: o.runs ?? [], items: o.items ?? [], cards: o.cards ?? [], names: o.names ?? [],
    health: o.health ?? ("ready" as WorkerHealth), themesLeft: { boy: 5, girl: 5, ...o.themesLeft },
    settings: { min_images: 6, max_images: 26, autopilot_name_themes: "Biblical (names from the Bible)\nSoft and cool", ...o.settings } as SettingsRow,
    requestPosts: {} as Record<string, string>, skipped: [] as { id: string; note: string }[], meanings: [] as { id: string; meaning: string }[], nextId: 1,
  };
  const repo: AutopilotRepo = {
    async activeRun() { return db.runs.find((r) => ["running", "waiting", "paused"].includes(r.status)) ?? null; },
    async lockRun(id, until, now) {
      const r = db.runs.find((x) => x.id === id);
      if (!r || (r.tick_until && r.tick_until >= now)) return false;
      r.tick_until = until;
      return true;
    },
    async runStatus(id) { return db.runs.find((x) => x.id === id)?.status ?? null; },
    async finishTick(id, patch: TickPatch) {
      const r = db.runs.find((x) => x.id === id)!;
      const { status, message, finished_at, ...rest } = patch;
      Object.assign(r, rest, { tick_until: null });
      if (r.status !== "stopped") Object.assign(r, { status, message }, finished_at ? { finished_at } : {});
    },
    async saveProgress(id, p) { Object.assign(db.runs.find((x) => x.id === id)!, p); },
    async postIdForRequest(requestId) { return db.requestPosts[requestId] ?? null; },
    async items(runId) { return db.items.filter((i) => i.run_id === runId).map((i) => ({ ...i })); },
    async updateItem(id, patch) { Object.assign(db.items.find((i) => i.id === id)!, patch); },
    async cards(postIds) { return db.cards.filter((c) => c.post_id && postIds.includes(c.post_id)).map((c) => ({ ...c })); },
    async updateCard(id, patch) { Object.assign(db.cards.find((c) => c.id === id)!, patch); },
    async markCardsPending(postId) { for (const c of db.cards) if (c.post_id === postId) c.check_state = "pending"; },
    async signedUrls(paths) { return paths.map((p) => `https://signed/${p}`); },
    async pcHealth() { return db.health; },
    async themesLeft(g) { return db.themesLeft[g]; },
    async settings() { return db.settings; },
    async allNames() { return db.names.map((n) => ({ ...n })); },
    async skipName(id, note) { db.skipped.push({ id, note }); const n = db.names.find((x) => x.id === id); if (n) n.status = "skip"; },
    async setMeaning(id, meaning) { db.meanings.push({ id, meaning }); },
    async addNames(rows) {
      return rows.map((r) => {
        const row: RepoName = { id: `new-${db.nextId++}`, name: r.name, meaning: r.meaning, gender: r.gender, style: "single", status: "available" };
        db.names.push(row);
        return { id: row.id, name: row.name };
      });
    },
  };
  return { repo, db };
}
