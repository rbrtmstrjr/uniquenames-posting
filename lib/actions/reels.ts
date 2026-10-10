"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ReelRow, ReelSceneRow, ReelSceneStatus, ReelStatus, SettingsRow } from "@/lib/db/types";
import {
  ACTION_MAX, HOOK_TEXT_MAX, HOOK_TEXT_MAX_WORDS, LINE_MAX_WORDS, lightClean, TITLE_MAX, writeReelScript, type MadeReel, type ReelScript,
} from "@/lib/ai/reel-script";
import { assignMotion, emotionOf, shotOf } from "@/lib/reels/motion";
import { isGuideThemeId } from "@/lib/reels/guide";
import { imagePrompt } from "@/lib/reels/image-prompt";
import { punchIn } from "@/lib/reels/shots";
import { DEFAULT_THEME_ID, isThemeId, LEGACY_THEME_ID, staticTheme, THEME_PARTIAL, themeOf, type ReelTheme } from "@/lib/reels/themes";
import { speedOf } from "@/lib/reels/voices";
import { isReelFormat, nextFormat, type ReelFormat } from "@/lib/reels/formats";
import { isHealthTopic, pickTopic, REEL_TOPICS, TOPIC_WINDOW, topicById, type ReelTopic } from "@/lib/reels/topics";
import { EXCLUDE_MAX, ideaKey, type TopicIdea } from "@/lib/reels/topic-ideas";
import { suggestTopicIdeas } from "@/lib/ai/reel-ideas";
import { generateLockReason } from "./generate-guard";
import { UUID_RE } from "./helpers";
import { fail, requireOwner, type ActionResult } from "./result";
import { later } from "./later";
import { makeReelCaption, missingColumn as missing009Column, type ReelCaptionSource } from "@/lib/captions/load";
import { REWRITE_TIMEOUT_MS } from "@/lib/ai/caption";

type SB = Awaited<ReturnType<typeof createClient>>;
type DbError = { message: string; code?: string };

// A "use server" file may only export async functions (and types): limits stay local.
const TOPIC_MAX = 120;
/** A picked card's hook (≤ 12 words; generous for safety). */
const HOOK_HINT_MAX = 160;
/** One budget for Gemini across the first try and up to 2 rewrites (the reels pages allow 300 s). */
const SCRIPT_BUDGET_MS = 270_000;
/** One call's cap: a 60-90 s script takes Opus 5.5 about 105-140 s. */
const CALL_MAX_MS = 180_000;
/** Below this, another Gemini call cannot finish: stop and show the last error. */
const CALL_MIN_MS = 10_000;
const TRIES = 3;
const IDEA_MAX = 600;
const NARRATION_MAX = 200;
const BUCKET = "reels";

const NEEDS_005 = "Run supabase/migrations/005_reels.sql first.";
const NEEDS_007 = "Visual themes need the database update first (run supabase/migrations/007_reel_themes.sql).";
const NEEDS_008 = "The hook card needs the database update first (run supabase/migrations/008_reel_playbook.sql).";
const NEEDS_009 = "Reel captions need the database update first (run supabase/migrations/009_captions.sql).";
const NEEDS_014 = "On-screen labels need the database update first (run supabase/migrations/014_reel_formats.sql).";
/** A line's on-screen label (014): at most 8 words / 80 characters, never on line 1. */
const LABEL_MAX = 80;
const LABEL_MAX_WORDS = 8;
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
/** The columns migration 007 adds (reel_scenes + reels.theme_id), the ones 008 adds (reel_scenes + reels.hook_text) and 012's. */
const COLS_007 = ["emotion", "action", "shot", "key_moment", "motion", "theme_id"] as const;
const COLS_008 = ["shot_size", "subject", "punch", "time_jump", "hook_text"] as const;
const COLS_012 = ["feeling", "thread"] as const;
/** 014: the reel's format + topic-bank id and each line's on-screen label. */
const COLS_014 = ["format", "topic_id", "on_screen"] as const;
const missingColumn = (e: DbError, cols: readonly string[]) =>
  (e.code === "PGRST204" || e.code === "42703" || /schema cache/i.test(e.message)) &&
  new RegExp(`\\b(${cols.join("|")})\\b`).test(e.message);
/** A write naming a 007 column that the database does not have yet (PGRST204 / 42703). */
const missing007Column = (e: DbError) => missingColumn(e, COLS_007);
const missing008Column = (e: DbError) => missingColumn(e, COLS_008);
const missing012Column = (e: DbError) => missingColumn(e, COLS_012);
const missing014Column = (e: DbError) => missingColumn(e, COLS_014);
const drop = (row: Record<string, unknown>, cols: readonly string[]) => Object.fromEntries(Object.entries(row).filter(([k]) => !cols.includes(k)));
/** Before 014: no format / topic id on the reel, no on-screen label per line. */
const without014 = (row: Record<string, unknown>) => drop(row, COLS_014);
/** Before 012: no feeling / thread per line (the image prompt was already built with them). */
const without012 = (row: Record<string, unknown>) => drop(row, [...COLS_012, ...COLS_014]);
/** Before 008: no shot list / punch / hook card, and 'hold' is not a valid move yet (it plays as a push-in). */
const without008 = (row: Record<string, unknown>) => {
  const r = drop(row, [...COLS_008, ...COLS_012, ...COLS_014]);
  return r.motion === "hold" ? { ...r, motion: "push_in" } : r;
};
const without007 = (row: Record<string, unknown>) => drop(row, [...COLS_007, ...COLS_008, ...COLS_012, ...COLS_014]);

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
  /** Migration 014 has run (settings has reel_labels): reels.format / topic_id and reel_scenes.on_screen exist. */
  has014: boolean;
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
    has014: has007 && "reel_labels" in row!,
  };
}

/**
 * The theme to draw with: the reel's own, else the Settings default, else Crayon. Read from reel_themes (the live
 * wording); the static copy of the seed when the row can't be read, and Knitted Doll before 007. A guide style with
 * no row (a database before 012) draws as Knitted Doll, like before, so no reel ever points at a missing theme.
 */
async function loadTheme(sb: SB, id: string | null | undefined, has007: boolean): Promise<ReelTheme> {
  if (!has007) return staticTheme(LEGACY_THEME_ID);
  const want = isThemeId(id) ? id : DEFAULT_THEME_ID;
  const { data, error } = await sb.from("reel_themes").select("id, style, faces").eq("id", want).maybeSingle();
  if (error) return staticTheme(want);
  if (!data && isGuideThemeId(want)) return staticTheme(LEGACY_THEME_ID);
  return themeOf(data, want);
}

/** The latest reels' formats, topic-bank ids and titles + topics, newest first (select *: before 014 the fields are simply absent). */
async function recentReels(sb: SB): Promise<{ formats: (string | null)[]; topicIds: string[]; titles: string[] }> {
  const { data } = await sb.from("reels").select("*").order("created_at", { ascending: false }).limit(TOPIC_WINDOW);
  const rows = (data ?? []) as Partial<ReelRow>[];
  return {
    formats: rows.map((r) => r.format ?? null),
    // a reel from before 014 (or a typed topic equal to a bank one) is matched by its topic text
    topicIds: rows.map((r) => r.topic_id ?? REEL_TOPICS.find((t) => t.topic === r.topic)?.id).filter((x): x is string => !!x),
    titles: rows.flatMap((r) => [r.title, r.topic]).filter((x): x is string => typeof x === "string" && !!x.trim()),
  };
}

/** What a script is written about: the topic, its format, its bank id (null = typed by the owner) and the health flag. */
interface ScriptBrief {
  topic: string | undefined; format: ReelFormat; topicId: string | null; health: boolean;
  /** The bank idea's vetted facts + safety line (health topics) and verified anchor; absent for a typed topic. */
  facts?: string[]; safety?: string; anchor?: string;
  /** The picked topic card's hook (a suggested line 1). */
  hook?: string;
}
/** What the brief keeps: the reel's format + bank id (New script), or the picked topic card's (+ its hook / health flag). */
interface Keep { format?: string | null; topicId?: string | null; hook?: string; health?: boolean }
/** The vetted extras of a bank idea. */
const vetted = (t: ReelTopic) => ({ ...(t.facts ? { facts: t.facts } : {}), ...(t.safety ? { safety: t.safety } : {}), ...(t.anchor ? { anchor: t.anchor } : {}) });

/**
 * The brief of a new script. `keep` (New script): the reel's own format and topic when it has them. Otherwise the
 * format rotates (never the latest reel's, else the least recently used of the last 5) and a blank topic is picked from
 * the bank (not used by the last 15 reels, preferring the format).
 */
async function scriptBrief(sb: SB, topic: string | undefined, keep?: Keep): Promise<ScriptBrief> {
  const b = await baseBrief(sb, topic, keep);
  // a picked card: its hook is a suggested line 1; a fresh idea the AI flagged as health gets the health rules
  return { ...b, ...(keep?.hook ? { hook: keep.hook } : {}), health: b.health || (!b.topicId && keep?.health === true) };
}
async function baseBrief(sb: SB, topic: string | undefined, keep?: Keep): Promise<ScriptBrief> {
  // New script of a reel from before 014 whose topic is a bank idea: the same idea
  const bank = topicById(keep?.topicId) ?? (keep && topic ? REEL_TOPICS.find((t) => t.topic === topic) ?? null : null);
  const keptFormat = isReelFormat(keep?.format) ? keep!.format as ReelFormat : null;
  if (keptFormat && bank) return { topic: bank.topic, format: keptFormat, topicId: bank.id, health: bank.health, ...vetted(bank) };
  if (bank) topic = bank.topic;
  const recent = keptFormat && topic ? null : await recentReels(sb);
  const format = keptFormat ?? nextFormat(recent!.formats);
  if (bank) return { topic: bank.topic, format, topicId: bank.id, health: bank.health, ...vetted(bank) };
  if (topic) return { topic, format, topicId: null, health: isHealthTopic(topic) };
  const pick = pickTopic(format, recent!.topicIds);
  return { topic: pick.topic, format, topicId: pick.id, health: pick.health, ...vetted(pick) };
}

interface Draft { script: ReelScript; theme: ReelTheme; has007: boolean; has014: boolean; brief: ScriptBrief }

/**
 * Gemini writes a script for the reel's theme in its format; a title already made (case/space-insensitive) or a script
 * that fails validation is rewritten, up to 2 times, all within one 270 s budget (each call gets at most 180 s).
 */
async function draftScript(sb: SB, topic: string | undefined, reelThemeId?: string | null, keep?: Keep): Promise<ActionResult<Draft>> {
  const [made, set] = await Promise.all([madeReels(sb), scriptSettings(sb)]);
  if (made.error) return dbFail(made.error);
  const { maxScenes, speed, has007, has014 } = set;
  const [theme, brief] = await Promise.all([loadTheme(sb, reelThemeId ?? set.themeId, has007), scriptBrief(sb, topic, keep)]);
  const taken = new Set(made.rows.map((m) => titleKey(m.title ?? "")));
  const alreadyMade = made.rows.map((m) => ({ title: m.title, stage: m.stage ?? null }));
  const deadline = Date.now() + SCRIPT_BUDGET_MS;
  let last = "The AI did not answer.";
  for (let i = 0; i < TRIES; i++) {
    const left = deadline - Date.now();
    if (left < CALL_MIN_MS) break;
    const r = await writeReelScript({
      topic: brief.topic, format: brief.format, topicHealth: brief.health, topicFacts: brief.facts, topicSafety: brief.safety, topicAnchor: brief.anchor,
      ...(brief.hook ? { hookHint: brief.hook } : {}),
      maxScenes, alreadyMade, speed,
      theme: { id: theme.id, faces: theme.faces }, timeoutMs: Math.min(CALL_MAX_MS, left),
    });
    if (!r.ok) { last = r.error; continue; }
    if (taken.has(titleKey(r.script.title))) {
      last = `The AI kept picking a title you already made ("${r.script.title}"). Try again, or type a topic.`;
      continue;
    }
    // the format asked for is the reel's format (Gemini's own answer never overrides it)
    return { ok: true, script: { ...r.script, format: brief.format }, theme, has007, has014, brief };
  }
  return fail(last.startsWith("The AI kept") ? last : `Could not write the script: ${last}`);
}

/**
 * The scenes of a new script: built image prompts, fresh seeds; after 007 also each line's feeling, body language and
 * move, (008) its shot size, subject, punch word and time jump (key_moment = has a punch, for the 007 worker), and
 * (012, Crayon / Red Thread only) its "The feeling is ..." phrase and thread state.
 */
const sceneRows = (reelId: string, s: ReelScript, theme: ReelTheme, has007: boolean, has014 = false) => {
  const motions = assignMotion(s.scenes);
  return s.scenes.map((x, i) => ({
    reel_id: reelId, position: i + 1, beat: x.beat, idea: x.idea, narration: x.narration,
    image_prompt: imagePrompt(theme, s.cast, x, i), seed: randomSeed(), status: "pending" as const,
    ...(has007 ? {
      emotion: x.emotion, action: x.action || null, key_moment: !!x.punch, motion: motions[i],
      shot_size: x.shot_size, subject: x.subject, punch: x.punch, time_jump: x.time_jump,
      ...(x.feeling ? { feeling: x.feeling } : {}), ...(x.thread ? { thread: x.thread } : {}),
      ...(has014 ? { on_screen: x.on_screen ?? null } : {}),
    } : {}),
  }));
};

/**
 * Insert rows; a database still missing a 014 column gets them without the 014 fields, one missing a 012 column
 * without the 012 + 014 fields, one missing a 008 column without the 008 + 012 + 014 fields, one missing a 007 column
 * without all four.
 */
async function insertCompat(sb: SB, table: "reels" | "reel_scenes", rows: Record<string, unknown> | Record<string, unknown>[], select?: string) {
  const run = (r: typeof rows) => {
    const q = sb.from(table).insert(r);
    return select ? q.select(select).single() : q;
  };
  const map = (f: (r: Record<string, unknown>) => Record<string, unknown>) => (Array.isArray(rows) ? rows.map(f) : f(rows));
  let res = await run(rows);
  if (res.error && missing014Column(res.error)) res = await run(map(without014));
  if (res.error && missing012Column(res.error)) res = await run(map(without012));
  if (res.error && missing008Column(res.error)) res = await run(map(without008));
  if (res.error && missing007Column(res.error)) res = await run(map(without007));
  return res;
}

async function getReel(sb: SB, id: string): Promise<{ reel: ReelRow | null; error?: DbError }> {
  const { data, error } = await sb.from("reels").select("*").eq("id", id).maybeSingle();
  return { reel: (data as ReelRow | null) ?? null, error: error ?? undefined };
}
async function getScenes(sb: SB, reelId: string): Promise<{ scenes: ReelSceneRow[]; error?: DbError }> {
  const { data, error } = await sb.from("reel_scenes").select("*").eq("reel_id", reelId).order("position");
  return { scenes: (data ?? []) as ReelSceneRow[], error: error ?? undefined };
}

/**
 * After a new script: Gemini writes the reel's post caption + hashtags in the background (after the response), so the
 * script is never held up; on any failure (or before 009, when the reel has no caption column) it stays null and the
 * owner can tap Write caption. A caption written meanwhile by Rewrite caption is never overwritten.
 */
function captionLater(sb: SB, reel: ReelCaptionSource, replace: boolean) {
  later(async () => {
    const { data: settings } = await sb.from("settings").select("*").eq("id", 1).maybeSingle();
    if (!settings || !("hashtag_pool" in (settings as object))) return; // 009 not run: no caption columns, no Gemini call
    const made = await makeReelCaption(sb, reel, undefined, settings as SettingsRow);
    if (!made) return;
    let q = sb.from("reels").update(made).eq("id", reel.id);
    if (!replace) q = q.is("caption", null);
    const { error } = await q;
    if (error && !missing009Column(error)) console.error("reel caption: could not save it:", error.message);
  });
}

/**
 * "Suggest topics": 5 quick ideas before the long script (about 3 from the bank, not used lately, formats spread out,
 * and about 2 fresh AI ideas), with a suggested hook and what the mom learns. One cheap AI call; if it fails the batch
 * is bank-only with plain hooks (never an error). `exclude`: the topics already shown ("More ideas").
 */
export async function suggestReelTopicsAction(input?: { exclude?: string[] }): Promise<ActionResult<{ ideas: TopicIdea[] }>> {
  await requireOwner();
  const ex = input?.exclude;
  if (ex !== undefined && (!Array.isArray(ex) || ex.some((x) => typeof x !== "string"))) return fail("Could not read the topics shown. Reload the page.");
  const exclude = (ex ?? []).map((x) => oneLine(x).slice(0, TOPIC_MAX)).filter(Boolean).slice(-EXCLUDE_MAX);
  const sb = await createClient();
  const recent = await recentReels(sb);
  const r = await suggestTopicIdeas({ recentFormats: recent.formats, recentIds: recent.topicIds, recentTitles: recent.titles, exclude });
  if (r.aiError) console.error("suggest topics: the AI failed, bank ideas only:", r.aiError);
  return { ok: true, ideas: r.ideas };
}

/** A picked topic card: its format, bank id, hook and health flag ("Suggest topics"). */
export interface PickedTopic { topic?: string; topicId?: string; format?: string; hook?: string; health?: boolean }

/**
 * "Write script": the AI writes it, then the reel (status script, its theme) and its scenes (pending) are saved. A
 * picked topic card (format, and for a bank idea its id) is written in THAT format with the bank's vetted facts, and
 * its hook is suggested as line 1; a typed topic keeps the rotation. A bank id whose topic was edited is dropped.
 */
export async function writeReelScriptAction(input: PickedTopic): Promise<ActionResult<{ reelId: string }>> {
  await requireOwner();
  if (input?.topic !== undefined && typeof input.topic !== "string") return fail("Type a topic, or leave it blank.");
  const topic = oneLine(input?.topic) || undefined;
  if (topic && topic.length > TOPIC_MAX) return fail(`Keep the topic under ${TOPIC_MAX} characters.`);
  if (input?.format !== undefined && !isReelFormat(input.format)) return fail("Pick the topic again: its format is unknown.");
  if ((input?.topicId !== undefined && typeof input.topicId !== "string") || (input?.hook !== undefined && typeof input.hook !== "string")) {
    return fail("Pick the topic again.");
  }
  const bank = topicById(input?.topicId);
  const keepBank = bank && (!topic || ideaKey(topic) === ideaKey(bank.topic)) ? bank : null;
  const hook = oneLine(input?.hook).slice(0, HOOK_HINT_MAX) || undefined;
  const picked = input?.format !== undefined || !!keepBank;
  const sb = await createClient();
  const d = await draftScript(sb, keepBank ? keepBank.topic : topic, undefined, picked ? {
    format: input.format ?? keepBank?.format ?? null, topicId: keepBank?.id ?? null, ...(hook ? { hook } : {}), health: input.health === true,
  } : undefined);
  if (!d.ok) return d;
  const s = d.script;
  // The theme is pinned on the reel: its image prompts are built with it (and the PC reads it, e.g. grayscale). The
  // reel's topic is the owner's, or the bank idea it was written about (014 also keeps the idea's id and the format).
  const { data, error } = await insertCompat(sb, "reels", {
    title: s.title, topic: d.brief.topic ?? null, stage: s.stage, doll_cast: s.cast, status: "script",
    ...(d.has007 ? { theme_id: d.theme.id, hook_text: s.hook_text } : {}),
    ...(d.has014 ? { format: s.format, topic_id: d.brief.topicId } : {}),
  }, "id");
  if (error || !data) return error ? dbFail(error) : fail("Could not save the reel.");
  const reelId = (data as unknown as { id: string }).id;
  const { error: se } = await insertCompat(sb, "reel_scenes", sceneRows(reelId, s, d.theme, d.has007, d.has014));
  if (se) {
    await sb.from("reels").delete().eq("id", reelId);
    return fail(missing005(se) ? NEEDS_005 : `Could not save the script: ${se.message}`);
  }
  captionLater(sb, { id: reelId, title: s.title, topic: d.brief.topic ?? null, stage: s.stage, hook_text: s.hook_text, format: s.format, lines: s.scenes.map((x) => x.narration) }, false);
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
  // Same topic (the owner's, or the same bank idea) and, from 014, the same format.
  const d = await draftScript(sb, reel.topic ?? undefined, "theme_id" in reel ? (reel.theme_id ?? LEGACY_THEME_ID) : undefined,
    { format: reel.format, topicId: reel.topic_id });
  if (!d.ok) return d;
  const s = d.script;
  const { data, error: ue } = await sb.from("reels")
    .update({
      title: s.title, stage: s.stage, doll_cast: s.cast, ...(d.has007 && "theme_id" in reel ? { theme_id: d.theme.id } : {}),
      ...("hook_text" in reel ? { hook_text: s.hook_text } : {}),
      ...("format" in reel ? { format: s.format, topic_id: d.brief.topicId } : {}), version: reel.version + 1,
    })
    .eq("id", reelId).eq("version", reel.version).eq("status", "script").select("id");
  if (ue) return dbFail(ue);
  if (!data?.length) return fail(STALE);
  const { error: de } = await sb.from("reel_scenes").delete().eq("reel_id", reelId);
  if (de) return fail(`Could not replace the script: ${de.message}`);
  const { error: ie } = await insertCompat(sb, "reel_scenes", sceneRows(reelId, s, d.theme, d.has007, d.has014 && "format" in reel));
  if (ie) return fail(`The new script's lines could not be saved (${ie.message}). Tap New script again.`);
  // A new script gets a new caption (the old one was about the old script).
  if ("caption" in reel) captionLater(sb, { id: reelId, title: s.title, topic: reel.topic, stage: s.stage, hook_text: s.hook_text, format: s.format, lines: s.scenes.map((x) => x.narration) }, true);
  return done();
}

/**
 * "Write caption" / "Rewrite caption" on a reel: a fresh caption + hashtags from its title, topic, hook and script,
 * different from the latest reel captions and hashtag sets. Works in every status (the PC never reads the caption).
 * On any AI failure the saved caption is unchanged.
 */
export async function rewriteReelCaptionAction(reelId: string): Promise<ActionResult<{ caption: string; hashtags: string }>> {
  await requireOwner();
  if (!UUID_RE.test(reelId ?? "")) return fail(NOT_FOUND);
  const sb = await createClient();
  const [{ reel, error }, { scenes, error: se }] = await Promise.all([getReel(sb, reelId), getScenes(sb, reelId)]);
  const readErr = error ?? se;
  if (readErr) return dbFail(readErr);
  if (!reel) return fail(NOT_FOUND);
  if (!("caption" in reel)) return fail(NEEDS_009);
  if (!scenes.length) return fail("This reel has no script yet, so there is nothing to write about.");
  const made = await makeReelCaption(sb, { ...reel, lines: scenes }, REWRITE_TIMEOUT_MS);
  if (!made) return fail("Could not write a caption right now. The caption is unchanged — try again in a moment.");
  const { data, error: ue } = await sb.from("reels").update(made).eq("id", reelId).select("id");
  if (ue) return fail(missing009Column(ue) ? NEEDS_009 : ue.message);
  if (!data?.length) return fail(NOT_FOUND);
  return { ok: true, ...made };
}

/**
 * The review page's edits. `emotion`, `action` and `shot` are optional (after 007): leave them out to keep the line's
 * own. `hookText` (after 008) is the hook card: leave it out to keep it, '' removes it. `on_screen` (after 014) is the
 * line's label: leave it out to keep it, '' removes it.
 */
export interface ReelScriptEdit {
  title: string;
  hookText?: string;
  lines: { id: string; narration: string; idea: string; emotion?: string; action?: string; shot?: string; on_screen?: string }[];
}

function badEdit(e: ReelScriptEdit): string | null {
  const title = oneLine(e?.title);
  if (!title) return "Give the reel a title.";
  if (title.length > TITLE_MAX) return `Keep the title under ${TITLE_MAX} characters.`;
  if (!Array.isArray(e.lines) || e.lines.length > 40) return "Bad script. Reload the page and try again.";
  if (e.hookText !== undefined) {
    if (typeof e.hookText !== "string") return "Bad hook card. Reload the page and try again.";
    const h = oneLine(e.hookText);
    if (wordCount(h) > HOOK_TEXT_MAX_WORDS || h.length > HOOK_TEXT_MAX) return `Keep the hook card to ${HOOK_TEXT_MAX_WORDS} words or fewer.`;
  }
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
    if (l.on_screen !== undefined) {
      if (typeof l.on_screen !== "string") return "Bad label. Reload the page and try again.";
      const label = oneLine(l.on_screen);
      if (label && positionOf(l.id) === 1) return "Line 1 has the hook card, so it has no on-screen label.";
      if (label.length > LABEL_MAX) return `${at}'s on-screen label is longer than ${LABEL_MAX} characters.`;
      if (wordCount(label) > LABEL_MAX_WORDS) return `${at}'s on-screen label is longer than ${LABEL_MAX_WORDS} words.`;
    }
  }
  return null;
}

/**
 * Review page "Save": the title, the hook card and any edited lines. An edited picture idea / feeling / body language /
 * framing rebuilds that line's image prompt with the reel's theme (its shot size and subject stay); edited words drop a
 * punch word that is no longer in the line. The camera moves depend only on the number of lines, so they stay.
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
  // 014: the lines carry on_screen; before it a label can't be saved (an empty one is simply ignored)
  const has014 = scenes.length > 0 && scenes.every((s) => "on_screen" in s);
  if (!has014 && edit.lines.some((l) => !!oneLine(l.on_screen))) return fail(NEEDS_014);
  const hook = edit.hookText === undefined ? undefined : (oneLine(edit.hookText) || null);
  const hookChanged = hook !== undefined && hook !== (reel.hook_text ?? null);
  if (hookChanged && !("hook_text" in reel)) return fail(NEEDS_008);
  const title = oneLine(edit.title);
  if (titleKey(title) !== titleKey(reel.title) && made.rows.some((m) => m.id !== reelId && titleKey(m.title ?? "") === titleKey(title))) return fail(DUP_TITLE);

  // Every line as it will be after the save.
  const edits = new Map(edit.lines.map((l) => [l.id, l]));
  const next = scenes.map((s) => {
    const l = edits.get(s.id);
    const label = s.on_screen ?? null;
    if (!l) return { s, edited: false, narration: s.narration, idea: s.idea, emotion: s.emotion ?? null, action: s.action ?? null, shot: s.shot ?? null, label };
    return {
      s, edited: true, narration: oneLine(l.narration), idea: lightClean(oneLine(l.idea)),
      emotion: l.emotion !== undefined ? emotionOf(l.emotion) : (s.emotion ?? null),
      action: l.action !== undefined ? (lightClean(oneLine(l.action)) || null) : (s.action ?? null),
      shot: l.shot !== undefined ? shotOf(l.shot) : (s.shot ?? null),
      label: has014 && l.on_screen !== undefined ? (oneLine(l.on_screen) || null) : label,
    };
  });
  const needsPrompt = (n: (typeof next)[number]) => n.idea !== n.s.idea || n.emotion !== (n.s.emotion ?? null) ||
    n.action !== (n.s.action ?? null) || n.shot !== (n.s.shot ?? null);
  // The theme is read only when a prompt must be rebuilt.
  let theme: ReelTheme | null = null;
  if (next.some((n) => n.edited && needsPrompt(n))) {
    const set = await scriptSettings(sb);
    // null = a legacy reel or a deleted theme: Knitted Doll (new reels always pin their theme)
    theme = await loadTheme(sb, reel.theme_id ?? LEGACY_THEME_ID, set.has007);
  }

  const { data, error: ue } = await sb.from("reels").update({ title, ...(hookChanged ? { hook_text: hook } : {}), version: reel.version + 1 })
    .eq("id", reelId).eq("version", reel.version).eq("status", "script").select("id");
  if (ue) return dbFail(ue);
  if (!data?.length) return fail(STALE);

  const changes = next.flatMap((n) => {
    const s = n.s;
    const patch: Record<string, unknown> = {};
    if (n.edited && (n.narration !== s.narration || needsPrompt(n))) {
      patch.narration = n.narration;
      patch.idea = n.idea;
      if (n.emotion !== (s.emotion ?? null)) patch.emotion = n.emotion;
      if (n.action !== (s.action ?? null)) patch.action = n.action;
      if (n.shot !== (s.shot ?? null)) patch.shot = n.shot;
      if (needsPrompt(n)) {
        patch.image_prompt = imagePrompt(theme!, reel.doll_cast, {
          ...n, beat: s.beat, shot_size: s.shot_size, subject: s.subject, feeling: s.feeling, thread: s.thread,
        }, s.position - 1);
      }
      if (s.punch && !punchIn(n.narration, s.punch)) { patch.punch = null; patch.key_moment = false; }
    }
    // a new label only changes the label (the worker draws it over the picture)
    if (n.edited && n.label !== (s.on_screen ?? null)) patch.on_screen = n.label;
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
  // select * (not a column list): `active` (012) is missing before 012, when every theme is still offered
  const { data: row, error: te } = await sb.from("reel_themes").select("*").eq("id", themeId).maybeSingle();
  if (te) return fail(missing005(te) ? NEEDS_007 : te.message);
  if (!row || (row as { active?: boolean }).active === false) return fail(PICK_THEME);
  const theme = themeOf(row, themeId);
  const { data, error: ue } = await sb.from("reels").update({ theme_id: theme.id, version: reel.version + 1 })
    .eq("id", reelId).eq("version", reel.version).eq("status", "script").select("id");
  if (ue) return ue.code === "23503" ? fail(PICK_THEME) : fail(missing007Column(ue) ? NEEDS_007 : ue.message);
  if (!data?.length) return fail(STALE);
  const results = await Promise.all(scenes.map((s) => sb.from("reel_scenes")
    .update({ image_prompt: imagePrompt(theme, reel.doll_cast, s, s.position - 1), version: s.version + 1 })
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
