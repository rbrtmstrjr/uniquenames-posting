"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ReelRow, ReelSceneRow, ReelSceneStatus, ReelStatus, SettingsRow } from "@/lib/db/types";
import { ACTION_MAX, LINE_MAX_WORDS, lightClean, TITLE_MAX, writeReelScript, type MadeReel, type ReelScript } from "@/lib/ai/reel-script";
import { assignMotion, emotionOf, shotOf } from "@/lib/reels/motion";
import { scenePrompt } from "@/lib/reels/prompt";
import { DEFAULT_THEME_ID, isThemeId, staticTheme, THEME_PARTIAL, themeOf, type ReelTheme } from "@/lib/reels/themes";
import { speedOf } from "@/lib/reels/voices";
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
const NEEDS_007 = "Visual themes need the database update first (run supabase/migrations/007_reel_themes.sql).";
const STALE = "This reel just changed. Reload the page and try again.";
const NOT_FOUND = "Reel not found.";
const SCRIPT_CHANGED = "The script changed in another tab. Try again.";
const SCENE_NOT_FOUND = "Image not found.";
const DUP_TITLE = "Another reel already has that title.";
const PICK_THEME = "Pick a theme from the list.";

/** The reels tables (or a 005 column) are not on the live database yet. */
const missing005 = (e: DbError) =>
  e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204" || e.code === "42703" ||
  /relation .* does not exist|schema cache/i.test(e.message);
const dbFail = (e: DbError) => fail(missing005(e) ? NEEDS_005 : e.message);
/** The per-line columns migration 007 adds to reel_scenes (and reels.theme_id). */
const SCENE_007 = ["emotion", "action", "shot", "key_moment", "motion"] as const;
/** A write naming a 007 column that the database does not have yet (PGRST204 / 42703). */
const missing007Column = (e: DbError) =>
  (e.code === "PGRST204" || e.code === "42703" || /schema cache/i.test(e.message)) &&
  /\b(emotion|action|shot|key_moment|motion|theme_id)\b/.test(e.message);
const without007 = <T extends Record<string, unknown>>(row: T) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !(SCENE_007 as readonly string[]).includes(k) && k !== "theme_id"));

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

interface ScriptSettings {
  maxScenes: number; speed: number;
  /** settings.reel_theme_id (null before 007). */
  themeId: string | null;
  /** Migration 007 has run (settings has reel_theme_id): the theme and per-line columns exist. */
  has007: boolean;
}

/** Images per reel, the narration speed (1 before 006: the old worker never speeds the voice up) and the default theme. */
async function scriptSettings(sb: SB): Promise<ScriptSettings> {
  const { data } = await sb.from("settings").select("*").eq("id", 1).maybeSingle();
  const row = data as SettingsRow | null;
  const n = Number(row?.reel_max_images);
  const speed = row?.reel_speed === undefined || row?.reel_speed === null ? 1 : speedOf(row.reel_speed);
  const has007 = !!row && "reel_theme_id" in row;
  return {
    maxScenes: Number.isInteger(n) ? Math.min(40, Math.max(10, n)) : 40, speed,
    themeId: has007 && isThemeId(row!.reel_theme_id) ? row!.reel_theme_id! : null, has007,
  };
}

/**
 * The theme to draw with: the reel's own, else the Settings default, else Knitted Doll. Read from reel_themes (the
 * live wording); the static copy of the seed when the row can't be read, and Knitted Doll before 007.
 */
async function loadTheme(sb: SB, id: string | null | undefined, has007: boolean): Promise<ReelTheme> {
  if (!has007) return staticTheme(DEFAULT_THEME_ID);
  const want = isThemeId(id) ? id : DEFAULT_THEME_ID;
  const { data, error } = await sb.from("reel_themes").select("id, style, faces").eq("id", want).maybeSingle();
  return error ? staticTheme(want) : themeOf(data, want);
}

/**
 * Gemini writes a script for the reel's theme; a title already made (case/space-insensitive) or a script that fails
 * validation is rewritten, up to 2 times, all within one 270 s budget (each call gets at most 120 s).
 */
async function draftScript(sb: SB, topic: string | undefined, reelThemeId?: string | null): Promise<ActionResult<{ script: ReelScript; theme: ReelTheme; has007: boolean }>> {
  const [made, set] = await Promise.all([madeReels(sb), scriptSettings(sb)]);
  if (made.error) return dbFail(made.error);
  const { maxScenes, speed, has007 } = set;
  const theme = await loadTheme(sb, reelThemeId ?? set.themeId, has007);
  const taken = new Set(made.rows.map((m) => titleKey(m.title ?? "")));
  const alreadyMade = made.rows.map((m) => ({ title: m.title, stage: m.stage ?? null }));
  const deadline = Date.now() + SCRIPT_BUDGET_MS;
  let last = "Gemini did not answer.";
  for (let i = 0; i < TRIES; i++) {
    const left = deadline - Date.now();
    if (left < CALL_MIN_MS) break;
    const r = await writeReelScript({ topic, maxScenes, alreadyMade, speed, theme: { id: theme.id, faces: theme.faces }, timeoutMs: Math.min(CALL_MAX_MS, left) });
    if (!r.ok) { last = r.error; continue; }
    if (taken.has(titleKey(r.script.title))) {
      last = `Gemini kept picking a title you already made ("${r.script.title}"). Try again, or type a topic.`;
      continue;
    }
    return { ok: true, script: r.script, theme, has007 };
  }
  return fail(last.startsWith("Gemini kept") ? last : `Could not write the script: ${last}`);
}

/** The scenes of a new script: built image prompts, fresh seeds; after 007 also each line's feeling, framing and move. */
const sceneRows = (reelId: string, s: ReelScript, theme: ReelTheme, has007: boolean) => {
  const motions = assignMotion(s.scenes);
  return s.scenes.map((x, i) => ({
    reel_id: reelId, position: i + 1, beat: x.beat, idea: x.idea, narration: x.narration,
    image_prompt: scenePrompt(theme, s.cast, x, i), seed: randomSeed(), status: "pending" as const,
    ...(has007 ? { emotion: x.emotion, action: x.action || null, shot: x.shot, key_moment: x.key, motion: motions[i] } : {}),
  }));
};

/** Insert rows; a database still missing a 007 column gets them without the 007 fields. */
async function insert007(sb: SB, table: "reels" | "reel_scenes", rows: Record<string, unknown> | Record<string, unknown>[], select?: string) {
  const run = (r: typeof rows) => {
    const q = sb.from(table).insert(r);
    return select ? q.select(select).single() : q;
  };
  const first = await run(rows);
  if (!first.error || !missing007Column(first.error)) return first;
  return run(Array.isArray(rows) ? rows.map(without007) : without007(rows));
}

async function getReel(sb: SB, id: string): Promise<{ reel: ReelRow | null; error?: DbError }> {
  const { data, error } = await sb.from("reels").select("*").eq("id", id).maybeSingle();
  return { reel: (data as ReelRow | null) ?? null, error: error ?? undefined };
}
async function getScenes(sb: SB, reelId: string): Promise<{ scenes: ReelSceneRow[]; error?: DbError }> {
  const { data, error } = await sb.from("reel_scenes").select("*").eq("reel_id", reelId).order("position");
  return { scenes: (data ?? []) as ReelSceneRow[], error: error ?? undefined };
}

/** "Write script": Gemini writes it, then the reel (status script, its theme) and its scenes (pending) are saved. */
export async function writeReelScriptAction(input: { topic?: string }): Promise<ActionResult<{ reelId: string }>> {
  await requireOwner();
  if (input?.topic !== undefined && typeof input.topic !== "string") return fail("Type a topic, or leave it blank.");
  const topic = oneLine(input?.topic) || undefined;
  if (topic && topic.length > TOPIC_MAX) return fail(`Keep the topic under ${TOPIC_MAX} characters.`);
  const sb = await createClient();
  const d = await draftScript(sb, topic);
  if (!d.ok) return d;
  const s = d.script;
  // The theme is pinned on the reel: its image prompts are built with it (and the PC reads it, e.g. grayscale).
  const { data, error } = await insert007(sb, "reels", {
    title: s.title, topic: topic ?? null, stage: s.stage, doll_cast: s.cast, status: "script",
    ...(d.has007 ? { theme_id: d.theme.id } : {}),
  }, "id");
  if (error || !data) return error ? dbFail(error) : fail("Could not save the reel.");
  const reelId = (data as unknown as { id: string }).id;
  const { error: se } = await insert007(sb, "reel_scenes", sceneRows(reelId, s, d.theme, d.has007));
  if (se) {
    await sb.from("reels").delete().eq("id", reelId);
    return fail(missing005(se) ? NEEDS_005 : `Could not save the script: ${se.message}`);
  }
  revalidatePath("/reels", "layout");
  return { ok: true, reelId };
}

/** "New script": a fresh script for the same topic and theme, replacing the title, cast and every line. */
export async function rewriteReelScriptAction(reelId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(reelId ?? "")) return fail(NOT_FOUND);
  const sb = await createClient();
  const { reel, error } = await getReel(sb, reelId);
  if (error) return dbFail(error);
  if (!reel) return fail(NOT_FOUND);
  if (reel.status !== "script") return fail("This reel was already approved, so its script can't change.");
  // The reel keeps its theme; null = a legacy reel or a deleted theme: Knitted Doll.
  const d = await draftScript(sb, reel.topic ?? undefined, "theme_id" in reel ? (reel.theme_id ?? DEFAULT_THEME_ID) : undefined);
  if (!d.ok) return d;
  const s = d.script;
  const { data, error: ue } = await sb.from("reels")
    .update({ title: s.title, stage: s.stage, doll_cast: s.cast, ...(d.has007 && "theme_id" in reel ? { theme_id: d.theme.id } : {}), version: reel.version + 1 })
    .eq("id", reelId).eq("version", reel.version).eq("status", "script").select("id");
  if (ue) return dbFail(ue);
  if (!data?.length) return fail(STALE);
  const { error: de } = await sb.from("reel_scenes").delete().eq("reel_id", reelId);
  if (de) return fail(`Could not replace the script: ${de.message}`);
  const { error: ie } = await insert007(sb, "reel_scenes", sceneRows(reelId, s, d.theme, d.has007));
  if (ie) return fail(`The new script's lines could not be saved (${ie.message}). Tap New script again.`);
  return done();
}

/**
 * The review page's edits. `emotion`, `action` and `shot` are optional (after 007): leave them out to keep the line's
 * own; an emotion change also re-picks the camera moves of the whole reel.
 */
export interface ReelScriptEdit {
  title: string;
  lines: { id: string; narration: string; idea: string; emotion?: string; action?: string; shot?: string }[];
}

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
    if (l.emotion !== undefined && !emotionOf(l.emotion)) return `${at}: pick a feeling from the list.`;
    if (l.shot !== undefined && !shotOf(l.shot)) return `${at}: pick a framing from the list.`;
    if (l.action !== undefined && (typeof l.action !== "string" || oneLine(l.action).length > ACTION_MAX)) return `${at}'s body language is longer than ${ACTION_MAX} characters.`;
  }
  return null;
}

/**
 * Review page "Save": the title and any edited lines. An edited picture idea / feeling / body language / framing
 * rebuilds that line's image prompt with the reel's theme; an edited feeling re-picks the camera moves.
 */
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
  const has007 = scenes.length > 0 && scenes.every((s) => "emotion" in s);
  if (!has007 && edit.lines.some((l) => l.emotion !== undefined || l.action !== undefined || l.shot !== undefined)) return fail(NEEDS_007);
  const title = oneLine(edit.title);
  if (titleKey(title) !== titleKey(reel.title) && made.rows.some((m) => m.id !== reelId && titleKey(m.title ?? "") === titleKey(title))) return fail(DUP_TITLE);

  // Every line as it will be after the save.
  const edits = new Map(edit.lines.map((l) => [l.id, l]));
  const next = scenes.map((s) => {
    const l = edits.get(s.id);
    if (!l) return { s, edited: false, narration: s.narration, idea: s.idea, emotion: s.emotion ?? null, action: s.action ?? null, shot: s.shot ?? null };
    return {
      s, edited: true, narration: oneLine(l.narration), idea: lightClean(oneLine(l.idea)),
      emotion: l.emotion !== undefined ? emotionOf(l.emotion) : (s.emotion ?? null),
      action: l.action !== undefined ? (lightClean(oneLine(l.action)) || null) : (s.action ?? null),
      shot: l.shot !== undefined ? shotOf(l.shot) : (s.shot ?? null),
    };
  });
  const motions = has007 && next.some((n) => n.emotion !== (n.s.emotion ?? null))
    ? assignMotion(next.map((n) => ({ beat: n.s.beat, emotion: n.emotion, key: n.s.key_moment })))
    : null;
  const needsPrompt = (n: (typeof next)[number]) => n.idea !== n.s.idea || n.emotion !== (n.s.emotion ?? null) ||
    n.action !== (n.s.action ?? null) || n.shot !== (n.s.shot ?? null);
  // The theme is read only when a prompt must be rebuilt.
  let theme: ReelTheme | null = null;
  if (next.some((n) => n.edited && needsPrompt(n))) {
    const set = await scriptSettings(sb);
    // null = a legacy reel or a deleted theme: Knitted Doll (new reels always pin their theme)
    theme = await loadTheme(sb, reel.theme_id ?? DEFAULT_THEME_ID, set.has007);
  }

  const { data, error: ue } = await sb.from("reels").update({ title, version: reel.version + 1 })
    .eq("id", reelId).eq("version", reel.version).eq("status", "script").select("id");
  if (ue) return dbFail(ue);
  if (!data?.length) return fail(STALE);

  const changes = next.flatMap((n, i) => {
    const s = n.s;
    const patch: Record<string, unknown> = {};
    if (n.edited && (n.narration !== s.narration || needsPrompt(n))) {
      patch.narration = n.narration;
      patch.idea = n.idea;
      if (n.emotion !== (s.emotion ?? null)) patch.emotion = n.emotion;
      if (n.action !== (s.action ?? null)) patch.action = n.action;
      if (n.shot !== (s.shot ?? null)) patch.shot = n.shot;
      if (needsPrompt(n)) patch.image_prompt = scenePrompt(theme!, reel.doll_cast, n, s.position - 1);
    }
    if (motions && motions[i] !== (s.motion ?? null)) patch.motion = motions[i];
    if (!Object.keys(patch).length) return [];
    patch.version = s.version + 1;
    return [sb.from("reel_scenes").update(patch).eq("id", s.id).eq("version", s.version).eq("status", "pending").select("id")];
  });
  const results = await Promise.all(changes);
  const failed = results.find((r) => r.error)?.error;
  if (failed) return fail(`The title was saved, but some lines were not: ${failed.message}`);
  if (results.some((r) => !r.data?.length)) return fail(`The title was saved, but some lines just changed. Reload the page and check them.`);
  return done();
}

/**
 * The review page's theme picker: only while the script waits for review (version-guarded). The theme is saved on
 * the reel and every line's image prompt is rebuilt with it (the words, feelings and framings stay).
 */
export async function setReelThemeAction(reelId: string, themeId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(reelId ?? "")) return fail(NOT_FOUND);
  if (!isThemeId(themeId)) return fail(PICK_THEME);
  const sb = await createClient();
  const [{ reel, error }, { scenes, error: se }] = await Promise.all([getReel(sb, reelId), getScenes(sb, reelId)]);
  const readErr = error ?? se;
  if (readErr) return dbFail(readErr);
  if (!reel) return fail(NOT_FOUND);
  if (reel.status !== "script") return fail("The theme can only be changed before you approve the script.");
  if (!("theme_id" in reel)) return fail(NEEDS_007);
  const { data: row, error: te } = await sb.from("reel_themes").select("id, style, faces").eq("id", themeId).maybeSingle();
  if (te) return fail(missing005(te) ? NEEDS_007 : te.message);
  if (!row) return fail(PICK_THEME);
  const theme = themeOf(row, themeId);
  const { data, error: ue } = await sb.from("reels").update({ theme_id: theme.id, version: reel.version + 1 })
    .eq("id", reelId).eq("version", reel.version).eq("status", "script").select("id");
  if (ue) return ue.code === "23503" ? fail(PICK_THEME) : fail(missing007Column(ue) ? NEEDS_007 : ue.message);
  if (!data?.length) return fail(STALE);
  const results = await Promise.all(scenes.map((s) => sb.from("reel_scenes")
    .update({ image_prompt: scenePrompt(theme, reel.doll_cast, s, s.position - 1), version: s.version + 1 })
    .eq("id", s.id).eq("version", s.version).eq("status", "pending").select("id")));
  const failed = results.find((r) => r.error)?.error;
  if (failed) return fail(`${THEME_PARTIAL} some pictures were not updated (${failed.message}). Tap Retry.`);
  if (results.some((r) => !r.data?.length)) return fail(`${THEME_PARTIAL} some lines just changed. Tap Retry to update every picture.`);
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
  // A failed New script insert can leave a reel with no lines: the voice would fail forever.
  if (!scenes.length) return fail("This script has no lines. Tap New script.");
  // Scenes first: the PC never claims anything of a reel still in 'script', so once the reel is
  // queued every image is already in line.
  const pending = scenes.filter((s) => s.status === "pending");
  const moved = await moveScenes(sb, pending, "pending", { status: "queued" });
  // Back to pending (only the scenes THIS call moved), so the script can still be edited.
  const revert = () => Promise.all(moved.done.map((s) => sb.from("reel_scenes").update({ status: "pending", version: s.version + 1 })
    .eq("id", s.id).eq("version", s.version).eq("status", "queued")));
  if (moved.error) { await revert(); return dbFail(moved.error); }
  // A pending scene in a queued reel is never claimed (the render waits for it forever): every line
  // must have moved, and none may be left (or added) as pending by another tab.
  const left = moved.done.length === pending.length
    ? await sb.from("reel_scenes").select("id").eq("reel_id", reelId).eq("status", "pending").limit(1)
    : null;
  if (left?.error) { await revert(); return dbFail(left.error); }
  if (!left || left.data?.length) { await revert(); return fail(SCRIPT_CHANGED); }
  const { data, error: ue } = await sb.from("reels")
    .update({ status: "queued", error: null, version: reel.version + 1 })
    .eq("id", reelId).eq("version", reel.version).eq("status", "script").select("id");
  if (ue || !data?.length) {
    await revert();
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
// pc_path stays: the worker replaces that file when the new video is made (no stray copies on the PC).
const REQUEUE_REEL = { status: "queued", preview_path: null, error: null, claimed_at: null, finished_at: null };
/** A music bed that failed ('') is tried again when the video is made again (null = not made yet). */
const retryMusic = (reel: ReelRow) => (reel.music_path === "" ? { music_path: null } : {});

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
  const { data: rd, error: re } = await sb.from("reels").update({ ...REQUEUE_REEL, ...retryMusic(reel), version: reel.version + 1 })
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
    .update({ status: "queued", preview_path: null, error: null, claimed_at: null, finished_at: null, ...retryMusic(reel), version: reel.version + 1 })
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
    .update({ status: "queued", error: null, claimed_at: null, finished_at: null, preview_path: null, ...retryMusic(reel), version: reel.version + 1 })
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
