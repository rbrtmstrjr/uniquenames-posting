"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ReelRow, ReelSceneRow, ReelSceneStatus, ReelStatus, SettingsRow } from "@/lib/db/types";
import { LINE_MAX_WORDS, lightClean, TITLE_MAX, writeReelScript, type MadeReel, type ReelScript } from "@/lib/ai/reel-script";
import { scenePrompt } from "@/lib/reels/prompt";
import { generateLockReason } from "./generate-guard";
import { UUID_RE } from "./helpers";
import { fail, requireOwner, type ActionResult } from "./result";

type SB = Awaited<ReturnType<typeof createClient>>;
type DbError = { message: string; code?: string };

// A "use server" file may only export async functions (and types): limits stay local.
const TOPIC_MAX = 120;
/** One budget for Gemini across the first try and up to 2 rewrites (the reels pages allow 300 s). */
const SCRIPT_BUDGET_MS = 270_000;
const CALL_MAX_MS = 120_000;
/** Below this, another Gemini call cannot finish: stop and show the last error. */
const CALL_MIN_MS = 10_000;
const TRIES = 3;
const IDEA_MAX = 600;
const NARRATION_MAX = 200;
const BUCKET = "reels";

const NEEDS_005 = "Run supabase/migrations/005_reels.sql first.";
const STALE = "This reel just changed. Reload the page and try again.";
const NOT_FOUND = "Reel not found.";
const SCENE_NOT_FOUND = "Image not found.";
const DUP_TITLE = "Another reel already has that title.";

/** The reels tables (or a 005 column) are not on the live database yet. */
const missing005 = (e: DbError) =>
  e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204" || e.code === "42703" ||
  /relation .* does not exist|schema cache/i.test(e.message);
const dbFail = (e: DbError) => fail(missing005(e) ? NEEDS_005 : e.message);

const oneLine = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
/** Case- and space-insensitive title key ("Old  Title" = "old title" = "OldTitle"). */
const titleKey = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const wordCount = (s: string) => s.split(" ").filter(Boolean).length;
/** A random positive 31-bit seed (ComfyUI is deterministic: a new seed = a new picture). */
const randomSeed = (avoid?: number) => {
  let s = Math.floor(Math.random() * 0x7ffffffe) + 1;
  if (s === avoid) s = (s % 0x7ffffffe) + 1;
  return s;
};
const done = () => { revalidatePath("/reels", "layout"); return { ok: true as const }; };

/** Every reel's title + stage, newest first (the "already made" list and the duplicate-title check). */
async function madeReels(sb: SB): Promise<{ rows: (MadeReel & { id?: string })[]; error?: DbError }> {
  const rows: (MadeReel & { id?: string })[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("reels").select("id, title, stage").order("created_at", { ascending: false }).range(from, from + 999);
    if (error) return { rows, error };
    rows.push(...((data ?? []) as (MadeReel & { id?: string })[]));
    if ((data?.length ?? 0) < 1000) return { rows };
  }
}

async function maxImages(sb: SB): Promise<number> {
  const { data } = await sb.from("settings").select("*").eq("id", 1).maybeSingle();
  const n = Number((data as SettingsRow | null)?.reel_max_images);
  return Number.isInteger(n) ? Math.min(40, Math.max(10, n)) : 40;
}

/**
 * Gemini writes a script; a title already made (case/space-insensitive) or a script that fails
 * validation is rewritten, up to 2 times, all within one 270 s budget (each call gets at most 120 s).
 */
async function draftScript(sb: SB, topic: string | undefined): Promise<ActionResult<{ script: ReelScript }>> {
  const [made, maxScenes] = await Promise.all([madeReels(sb), maxImages(sb)]);
  if (made.error) return dbFail(made.error);
  const taken = new Set(made.rows.map((m) => titleKey(m.title ?? "")));
  const alreadyMade = made.rows.map((m) => ({ title: m.title, stage: m.stage ?? null }));
  const deadline = Date.now() + SCRIPT_BUDGET_MS;
  let last = "Gemini did not answer.";
  for (let i = 0; i < TRIES; i++) {
    const left = deadline - Date.now();
    if (left < CALL_MIN_MS) break;
    const r = await writeReelScript({ topic, maxScenes, alreadyMade, timeoutMs: Math.min(CALL_MAX_MS, left) });
    if (!r.ok) { last = r.error; continue; }
    if (taken.has(titleKey(r.script.title))) {
      last = `Gemini kept picking a title you already made ("${r.script.title}"). Try again, or type a topic.`;
      continue;
    }
    return { ok: true, script: r.script };
  }
  return fail(last.startsWith("Gemini kept") ? last : `Could not write the script: ${last}`);
}

const sceneRows = (reelId: string, s: ReelScript) =>
  s.scenes.map((x, i) => ({
    reel_id: reelId, position: i + 1, beat: x.beat, idea: x.idea, narration: x.narration,
    image_prompt: scenePrompt(s.cast, x.idea, x.beat, i), seed: randomSeed(), status: "pending" as const,
  }));

async function getReel(sb: SB, id: string): Promise<{ reel: ReelRow | null; error?: DbError }> {
  const { data, error } = await sb.from("reels").select("*").eq("id", id).maybeSingle();
  return { reel: (data as ReelRow | null) ?? null, error: error ?? undefined };
}
async function getScenes(sb: SB, reelId: string): Promise<{ scenes: ReelSceneRow[]; error?: DbError }> {
  const { data, error } = await sb.from("reel_scenes").select("*").eq("reel_id", reelId).order("position");
  return { scenes: (data ?? []) as ReelSceneRow[], error: error ?? undefined };
}

/** "Write script": Gemini writes it, then the reel (status script) and its scenes (pending) are saved. */
export async function writeReelScriptAction(input: { topic?: string }): Promise<ActionResult<{ reelId: string }>> {
  await requireOwner();
  if (input?.topic !== undefined && typeof input.topic !== "string") return fail("Type a topic, or leave it blank.");
  const topic = oneLine(input?.topic) || undefined;
  if (topic && topic.length > TOPIC_MAX) return fail(`Keep the topic under ${TOPIC_MAX} characters.`);
  const sb = await createClient();
  const d = await draftScript(sb, topic);
  if (!d.ok) return d;
  const s = d.script;
  const { data, error } = await sb.from("reels")
    .insert({ title: s.title, topic: topic ?? null, stage: s.stage, doll_cast: s.cast, status: "script" })
    .select("id").single();
  if (error || !data) return error ? dbFail(error) : fail("Could not save the reel.");
  const reelId = (data as { id: string }).id;
  const { error: se } = await sb.from("reel_scenes").insert(sceneRows(reelId, s));
  if (se) {
    await sb.from("reels").delete().eq("id", reelId);
    return fail(missing005(se) ? NEEDS_005 : `Could not save the script: ${se.message}`);
  }
  revalidatePath("/reels", "layout");
  return { ok: true, reelId };
}

/** "New script": a fresh script for the same topic, replacing the title, cast and every line. */
export async function rewriteReelScriptAction(reelId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(reelId ?? "")) return fail(NOT_FOUND);
  const sb = await createClient();
  const { reel, error } = await getReel(sb, reelId);
  if (error) return dbFail(error);
  if (!reel) return fail(NOT_FOUND);
  if (reel.status !== "script") return fail("This reel was already approved, so its script can't change.");
  const d = await draftScript(sb, reel.topic ?? undefined);
  if (!d.ok) return d;
  const s = d.script;
  const { data, error: ue } = await sb.from("reels")
    .update({ title: s.title, stage: s.stage, doll_cast: s.cast, version: reel.version + 1 })
    .eq("id", reelId).eq("version", reel.version).eq("status", "script").select("id");
  if (ue) return dbFail(ue);
  if (!data?.length) return fail(STALE);
  const { error: de } = await sb.from("reel_scenes").delete().eq("reel_id", reelId);
  if (de) return fail(`Could not replace the script: ${de.message}`);
  const { error: ie } = await sb.from("reel_scenes").insert(sceneRows(reelId, s));
  if (ie) return fail(`The new script's lines could not be saved (${ie.message}). Tap New script again.`);
  return done();
}

export interface ReelScriptEdit { title: string; lines: { id: string; narration: string; idea: string }[] }

function badEdit(e: ReelScriptEdit): string | null {
  const title = oneLine(e?.title);
  if (!title) return "Give the reel a title.";
  if (title.length > TITLE_MAX) return `Keep the title under ${TITLE_MAX} characters.`;
  if (!Array.isArray(e.lines) || e.lines.length > 40) return "Bad script. Reload the page and try again.";
  const seen = new Set<string>();
  for (const l of e.lines) {
    if (!l || typeof l.id !== "string" || !UUID_RE.test(l.id) || seen.has(l.id)) return "Bad line id. Reload the page and try again.";
    seen.add(l.id);
  }
  return null;
}

/** A line's text, numbered by its scene's position (the "Line N" the review page shows). */
function badLines(lines: ReelScriptEdit["lines"], positionOf: (id: string) => number): string | null {
  for (const l of lines) {
    const at = `Line ${positionOf(l.id)}`;
    const n = oneLine(l.narration);
    if (!n) return `${at} has no words.`;
    if (n.length > NARRATION_MAX || wordCount(n) > LINE_MAX_WORDS) return `${at} is longer than ${LINE_MAX_WORDS} words.`;
    const idea = oneLine(l.idea);
    if (!idea) return `${at} has no picture idea.`;
    if (idea.length > IDEA_MAX) return `${at}'s picture idea is longer than ${IDEA_MAX} characters.`;
  }
  return null;
}

/** Review page "Save": the title and any edited lines; an edited picture idea rebuilds its image prompt. */
export async function saveReelScriptAction(reelId: string, edit: ReelScriptEdit): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(reelId ?? "")) return fail(NOT_FOUND);
  const bad = badEdit(edit);
  if (bad) return fail(bad);
  const sb = await createClient();
  const [{ reel, error }, { scenes, error: se }, made] = await Promise.all([getReel(sb, reelId), getScenes(sb, reelId), madeReels(sb)]);
  const readErr = error ?? se ?? made.error;
  if (readErr) return dbFail(readErr);
  if (!reel) return fail(NOT_FOUND);
  if (reel.status !== "script") return fail("This reel was already approved, so its script can't change.");
  const byId = new Map(scenes.map((s) => [s.id, s]));
  if (edit.lines.some((l) => !byId.has(l.id))) return fail("A line of this script was replaced. Reload the page and try again.");
  const badLine = badLines(edit.lines, (id) => byId.get(id)!.position);
  if (badLine) return fail(badLine);
  const title = oneLine(edit.title);
  if (titleKey(title) !== titleKey(reel.title) && made.rows.some((m) => m.id !== reelId && titleKey(m.title ?? "") === titleKey(title))) return fail(DUP_TITLE);

  const { data, error: ue } = await sb.from("reels").update({ title, version: reel.version + 1 })
    .eq("id", reelId).eq("version", reel.version).eq("status", "script").select("id");
  if (ue) return dbFail(ue);
  if (!data?.length) return fail(STALE);

  const changes = edit.lines.flatMap((l) => {
    const s = byId.get(l.id)!;
    const narration = oneLine(l.narration);
    const idea = lightClean(oneLine(l.idea));
    if (narration === s.narration && idea === s.idea) return [];
    const patch: Record<string, unknown> = { narration, idea, version: s.version + 1 };
    if (idea !== s.idea) patch.image_prompt = scenePrompt(reel.doll_cast, idea, s.beat, s.position - 1);
    return [sb.from("reel_scenes").update(patch).eq("id", s.id).eq("version", s.version).eq("status", "pending").select("id")];
  });
  const results = await Promise.all(changes);
  const failed = results.find((r) => r.error)?.error;
  if (failed) return fail(`The title was saved, but some lines were not: ${failed.message}`);
  if (results.some((r) => !r.data?.length)) return fail(`The title was saved, but some lines just changed. Reload the page and check them.`);
  return done();
}

/** "Approve and make reel": the reel and every line go in line for the PC. */
export async function approveReelAction(reelId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(reelId ?? "")) return fail(NOT_FOUND);
  const sb = await createClient();
  const [{ reel, error }, lock] = await Promise.all([getReel(sb, reelId), generateLockReason(sb)]);
  if (error) return dbFail(error);
  if (!reel) return fail(NOT_FOUND);
  if (reel.status !== "script") return fail("This reel was already approved.");
  if (lock) return fail(lock);
  const { scenes, error: re } = await getScenes(sb, reelId);
  if (re) return dbFail(re);
  // Scenes first: the PC never claims anything of a reel still in 'script', so once the reel is
  // queued every image is already in line.
  const moved = await moveScenes(sb, scenes.filter((s) => s.status === "pending"), "pending", { status: "queued" });
  const { data, error: ue } = moved.error ? { data: null, error: moved.error } : await sb.from("reels")
    .update({ status: "queued", error: null, version: reel.version + 1 })
    .eq("id", reelId).eq("version", reel.version).eq("status", "script").select("id");
  if (ue || !data?.length) {
    // Back to pending (only the scenes THIS call moved), so the script can still be edited.
    await Promise.all(moved.done.map((s) => sb.from("reel_scenes").update({ status: "pending", version: s.version + 1 })
      .eq("id", s.id).eq("version", s.version).eq("status", "queued")));
    return ue ? dbFail(ue) : fail(STALE);
  }
  return done();
}

/** Version-guarded per-scene status change; returns the scenes this call changed (with their new version). */
async function moveScenes(sb: SB, scenes: ReelSceneRow[], from: ReelSceneStatus, patch: Record<string, unknown>) {
  const results = await Promise.all(scenes.map((s) =>
    sb.from("reel_scenes").update({ ...patch, version: s.version + 1 }).eq("id", s.id).eq("version", s.version).eq("status", from).select("id")));
  const done = scenes.filter((_, i) => !!results[i].data?.length).map((s) => ({ id: s.id, version: s.version + 1 }));
  return { done, error: results.find((r) => r.error)?.error as DbError | undefined };
}

/** The scene plus its reel and the Generate lock. */
async function getSceneAndReel(sb: SB, sceneId: string) {
  const { data, error } = await sb.from("reel_scenes").select("*").eq("id", sceneId).maybeSingle();
  const scene = (data as ReelSceneRow | null) ?? null;
  if (error || !scene) return { scene, reel: null, lock: null, error: error ?? undefined };
  const [{ reel, error: re }, lock] = await Promise.all([getReel(sb, scene.reel_id), generateLockReason(sb)]);
  return { scene, reel, lock, error: re };
}

/** Reel statuses where the PC is still making images: a requeued scene is simply picked up. */
const MAKING: ReelStatus[] = ["queued", "voicing", "imaging"];
/** Every status the PC works on. */
const WORKING: ReelStatus[] = [...MAKING, "rendering"];
/** Scenes that can be made again: finished, failed, or skipped earlier (a skipped image can come back). */
const REDOABLE: ReelSceneStatus[] = ["done", "failed", "skipped"];
const REQUEUE_REEL = { status: "queued", preview_path: null, pc_path: null, error: null, claimed_at: null, finished_at: null };

/**
 * Tap an image → "New picture" (also Retry after needs_attention): the scene goes back in line with
 * a new seed and fresh attempts. A reel already rendering / finished / stopped is re-queued without
 * its preview so the video is made again; while images are still being made only the scene changes.
 */
export async function redoReelSceneAction(sceneId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(sceneId ?? "")) return fail(SCENE_NOT_FOUND);
  const sb = await createClient();
  const { scene, reel, lock, error } = await getSceneAndReel(sb, sceneId);
  if (error) return dbFail(error);
  if (!scene || !reel) return fail(SCENE_NOT_FOUND);
  if (reel.status === "script") return fail("Approve the script first.");
  if (!REDOABLE.includes(scene.status)) return fail("This image is still being made. Wait for it to finish.");
  if (lock) return fail(lock);
  const v = scene.version + 1;
  const { data, error: ue } = await sb.from("reel_scenes")
    .update({ status: "queued", seed: randomSeed(scene.seed), attempts: 0, error: null, claimed_at: null, version: v })
    .eq("id", scene.id).eq("version", scene.version).in("status", REDOABLE).select("id");
  if (ue) return dbFail(ue);
  if (!data?.length) return fail("This image just changed. Reload the page and try again.");
  if (MAKING.includes(reel.status)) return done();
  const { data: rd, error: re } = await sb.from("reels").update({ ...REQUEUE_REEL, version: reel.version + 1 })
    .eq("id", reel.id).eq("version", reel.version).select("id");
  if (re || !rd?.length) {
    // Put the scene back as it was: a queued image in a reel that isn't in line would wait forever.
    await sb.from("reel_scenes")
      .update({ status: scene.status as ReelSceneStatus, seed: scene.seed, attempts: scene.attempts, error: scene.error, version: v + 1 })
      .eq("id", scene.id).eq("version", v).eq("status", "queued");
    return re ? dbFail(re) : fail(STALE);
  }
  return done();
}

/**
 * "Skip image": the video is made without that picture. For a failed image of a reel that needs
 * attention, or of a reel still in line / being made whose image already failed 3 times (before the
 * PC flags it; only the scene changes then, the PC's hold on the reel is left alone).
 */
export async function skipReelSceneAction(sceneId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(sceneId ?? "")) return fail(SCENE_NOT_FOUND);
  const sb = await createClient();
  const { scene, reel, error } = await getSceneAndReel(sb, sceneId);
  if (error) return dbFail(error);
  if (!scene || !reel) return fail(SCENE_NOT_FOUND);
  if (scene.status !== "failed") return fail("Only an image that failed can be skipped.");
  const inLine = WORKING.includes(reel.status) && scene.attempts >= 3;
  if (reel.status !== "needs_attention" && !inLine) return fail("An image can be skipped once it has failed 3 times.");
  const { data, error: ue } = await sb.from("reel_scenes")
    .update({ status: "skipped", error: null, claimed_at: null, version: scene.version + 1 })
    .eq("id", scene.id).eq("version", scene.version).eq("status", "failed").select("id");
  if (ue) return dbFail(ue);
  if (!data?.length) return fail("This image just changed. Reload the page and try again.");
  if (inLine) return done(); // already in line: the PC moves on by itself
  const { data: rd, error: re } = await sb.from("reels").update({ status: "queued", error: null, claimed_at: null, version: reel.version + 1 })
    .eq("id", reel.id).eq("version", reel.version).eq("status", "needs_attention").select("id");
  if (re) return dbFail(re);
  if (!rd?.length) return fail(STALE);
  return done();
}

/** "Make video again": render only (every image done or skipped, at least one done). */
export async function rerenderReelAction(reelId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(reelId ?? "")) return fail(NOT_FOUND);
  const sb = await createClient();
  const [{ reel, error }, { scenes, error: se }, lock] = await Promise.all([getReel(sb, reelId), getScenes(sb, reelId), generateLockReason(sb)]);
  const readErr = error ?? se;
  if (readErr) return dbFail(readErr);
  if (!reel) return fail(NOT_FOUND);
  if (reel.status !== "ready" && reel.status !== "failed") return fail("The video can be made again once the reel is ready or has stopped.");
  if (scenes.some((s) => s.status !== "done" && s.status !== "skipped")) return fail("Finish or skip every image first.");
  if (!scenes.some((s) => s.status === "done")) return fail("Every image was skipped, so there is nothing to show.");
  if (lock) return fail(lock);
  const { data, error: ue } = await sb.from("reels")
    .update({ status: "queued", preview_path: null, error: null, claimed_at: null, finished_at: null, version: reel.version + 1 })
    .eq("id", reelId).eq("version", reel.version).in("status", ["ready", "failed"]).select("id");
  if (ue) return dbFail(ue);
  if (!data?.length) return fail(STALE);
  return done();
}

/**
 * "Try again" for a reel that stopped (voice, timing or render failed): back in line where it stopped.
 * The voice, word times and finished images are kept; failed images get fresh attempts.
 */
export async function retryReelAction(reelId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(reelId ?? "")) return fail(NOT_FOUND);
  const sb = await createClient();
  const [{ reel, error }, { scenes, error: se }, lock] = await Promise.all([getReel(sb, reelId), getScenes(sb, reelId), generateLockReason(sb)]);
  const readErr = error ?? se;
  if (readErr) return dbFail(readErr);
  if (!reel) return fail(NOT_FOUND);
  if (reel.status !== "failed") return fail("Only a reel that stopped can be tried again.");
  if (reel.words !== null && !scenes.some((s) => s.status === "failed" || s.status === "done")) {
    return fail("Every image was skipped. Tap an image to make it again.");
  }
  if (lock) return fail(lock);
  // The reel first (version-guarded: one Try again wins), then its failed images get fresh attempts.
  const { data, error: ue } = await sb.from("reels")
    .update({ status: "queued", error: null, claimed_at: null, finished_at: null, preview_path: null, version: reel.version + 1 })
    .eq("id", reelId).eq("version", reel.version).eq("status", "failed").select("id");
  if (ue) return dbFail(ue);
  if (!data?.length) return fail(STALE);
  const moved = await moveScenes(sb, scenes.filter((s) => s.status === "failed"), "failed", { status: "queued", attempts: 0, error: null, claimed_at: null });
  if (moved.error) return fail(`The reel is back in line, but some failed images were not reset: ${moved.error.message}`);
  return done();
}

/** Every file under a folder of the reels bucket (folders come back from list() with a null id). */
async function listFiles(sb: SB, prefix: string, depth = 0): Promise<string[]> {
  const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  const out: string[] = [];
  for (const f of data as { name: string; id: string | null }[]) {
    const path = `${prefix}/${f.name}`;
    if (f.id) out.push(path);
    else if (depth < 3) out.push(...(await listFiles(sb, path, depth + 1)));
  }
  return out;
}

/** Delete a reel (its scenes cascade), then its stored voice / images / preview, best effort. */
export async function deleteReelAction(reelId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(reelId ?? "")) return fail(NOT_FOUND);
  const sb = await createClient();
  const { data, error } = await sb.from("reels").delete().eq("id", reelId).select("id");
  if (error) return dbFail(error);
  if (!data?.length) return fail(NOT_FOUND);
  try {
    // The worker stores under "<id>/…" in the reels bucket; "reels/<id>/…" is cleaned too in case a path carries the bucket name.
    const paths = [...(await listFiles(sb, reelId)), ...(await listFiles(sb, `reels/${reelId}`))];
    if (paths.length) {
      const { error: re } = await sb.storage.from(BUCKET).remove(paths);
      if (re) console.error("deleteReelAction: storage cleanup failed", re.message);
    }
  } catch (e) {
    console.error("deleteReelAction: storage cleanup failed", e instanceof Error ? e.message : e);
  }
  return done();
}
