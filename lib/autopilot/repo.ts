// The database as the Autopilot engine sees it: a small interface (tested with an in-memory version) and its Supabase
// implementation for the tick route (service-role client). Every method throws on a database error; the engine turns
// that into a logged event and tries again on the next tick.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutopilotItemRow, AutopilotRunRow, AutopilotRunStatus, CardRow, Gender, NameRow, SettingsRow, WorkerStatusRow } from "@/lib/db/types";
import { workerHealth, type WorkerHealth } from "@/lib/status/worker-health";

export type RepoName = Pick<NameRow, "id" | "name" | "meaning" | "gender" | "style" | "status">;
export type TickPatch = Pick<AutopilotRunRow, "status" | "message" | "events" | "input_tokens" | "output_tokens"> & { finished_at?: string };

export interface AutopilotRepo {
  activeRun(): Promise<AutopilotRunRow | null>;
  /** Take the tick lock: only when no tick holds it (tick_until empty or past). */
  lockRun(runId: string, until: string, now: string): Promise<boolean>;
  runStatus(runId: string): Promise<AutopilotRunStatus | null>;
  /** Save the tick's results and free the lock; never brings a stopped run back. */
  finishTick(runId: string, patch: TickPatch): Promise<void>;
  items(runId: string): Promise<AutopilotItemRow[]>;
  updateItem(id: string, patch: Partial<AutopilotItemRow>): Promise<void>;
  cards(postIds: string[]): Promise<CardRow[]>;
  updateCard(id: string, patch: Partial<CardRow>): Promise<void>;
  markCardsPending(postId: string): Promise<void>;
  signedUrls(paths: string[]): Promise<string[]>;
  pcHealth(now: number): Promise<WorkerHealth>;
  themesLeft(gender: Gender): Promise<number>;
  settings(): Promise<SettingsRow>;
  allNames(): Promise<RepoName[]>;
  skipName(id: string, note: string): Promise<void>;
  setMeaning(id: string, meaning: string): Promise<void>;
  addNames(rows: { name: string; meaning: string; gender: Gender }[]): Promise<{ id: string; name: string }[]>;
}

const PAGE = 1000;
const LINK_TTL_S = 3600;

type Res<T> = { data: T | null; error: { message: string; code?: string } | null };
function must<T>(r: Res<T>, what: string): T {
  if (r.error) throw new Error(`Could not ${what}: ${r.error.message}`);
  return r.data as T;
}

export function supabaseRepo(sb: SupabaseClient): AutopilotRepo {
  return {
    async activeRun() {
      const rows = must(await sb.from("autopilot_runs").select("*").in("status", ["running", "waiting", "paused"]).order("created_at", { ascending: false }).limit(1), "read the run");
      return ((rows ?? []) as AutopilotRunRow[])[0] ?? null;
    },
    async lockRun(runId, until, now) {
      const rows = must(await sb.from("autopilot_runs").update({ tick_until: until }).eq("id", runId).or(`tick_until.is.null,tick_until.lt.${now}`).select("id"), "lock the run");
      return !!(rows as unknown[] | null)?.length;
    },
    async runStatus(runId) {
      const row = must(await sb.from("autopilot_runs").select("status").eq("id", runId).maybeSingle(), "read the run");
      return (row as { status: AutopilotRunStatus } | null)?.status ?? null;
    },
    async finishTick(runId, patch) {
      const { status, message, finished_at, ...rest } = patch;
      const rows = must(await sb.from("autopilot_runs").update({ ...rest, status, message, ...(finished_at ? { finished_at } : {}), tick_until: null })
        .eq("id", runId).neq("status", "stopped").select("id"), "save the run");
      if (!(rows as unknown[] | null)?.length) must(await sb.from("autopilot_runs").update({ ...rest, tick_until: null }).eq("id", runId).select("id"), "save the run");
    },
    async items(runId) {
      return (must(await sb.from("autopilot_items").select("*").eq("run_id", runId).order("scheduled_for"), "read the plan") ?? []) as AutopilotItemRow[];
    },
    async updateItem(id, patch) { must(await sb.from("autopilot_items").update(patch).eq("id", id).select("id"), "save a planned post"); },
    async cards(postIds) {
      if (!postIds.length) return [];
      return (must(await sb.from("cards").select("*").in("post_id", postIds), "read the cards") ?? []) as CardRow[];
    },
    async updateCard(id, patch) { must(await sb.from("cards").update(patch).eq("id", id).select("id"), "save a card check"); },
    async markCardsPending(postId) { must(await sb.from("cards").update({ check_state: "pending" }).eq("post_id", postId).select("id"), "mark the cards for checking"); },
    async signedUrls(paths) {
      if (!paths.length) return [];
      const { data, error } = await sb.storage.from("cards").createSignedUrls(paths, LINK_TTL_S);
      if (error) throw new Error(`Could not make links to the cards: ${error.message}`);
      return (data ?? []).map((l) => l.signedUrl ?? "");
    },
    async pcHealth(now) {
      const { data, error } = await sb.from("worker_status").select("*").eq("id", 1).maybeSingle();
      if (error) throw new Error(`Could not read the PC status: ${error.message}`);
      return workerHealth((data ?? null) as WorkerStatusRow | null, now);
    },
    async themesLeft(gender) {
      const { count, error } = await sb.from("themes").select("id", { count: "exact", head: true }).eq("gender", gender).eq("status", "available");
      if (error) throw new Error(`Could not count the themes: ${error.message}`);
      return count ?? 0;
    },
    async settings() { return must(await sb.from("settings").select("*").eq("id", 1).single(), "read the settings") as SettingsRow; },
    async allNames() {
      const out: RepoName[] = [];
      for (let from = 0; ; from += PAGE) {
        const rows = (must(await sb.from("names").select("id, name, meaning, gender, style, status").order("id").range(from, from + PAGE - 1), "read the names") ?? []) as RepoName[];
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
    },
    async skipName(id, note) {
      must(await sb.from("names").update({ status: "skip", autopilot_note: note.slice(0, 200) }).eq("id", id).eq("status", "available").select("id"), "skip a name");
    },
    async setMeaning(id, meaning) { must(await sb.from("names").update({ meaning }).eq("id", id).select("id"), "fix a meaning"); },
    async addNames(rows) {
      if (!rows.length) return [];
      const full = rows.map((r) => ({ name: r.name, meaning: r.meaning, gender: r.gender, style: "single" as const, status: "available" as const }));
      const { data, error } = await sb.from("names").insert(full).select("id, name");
      if (!error) return (data ?? []) as { id: string; name: string }[];
      if (error.code !== "23505") throw new Error(`Could not add names: ${error.message}`);
      // One of them was just added elsewhere: add the others one by one.
      const out: { id: string; name: string }[] = [];
      for (const r of full) {
        const one = await sb.from("names").insert(r).select("id, name").single();
        if (one.error) {
          if (one.error.code === "23505") continue;
          throw new Error(`Could not add names: ${one.error.message}`);
        }
        if (one.data) out.push(one.data as { id: string; name: string });
      }
      return out;
    },
  };
}
