"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ReelRow, ReelVoiceRow } from "@/lib/db/types";
import { geminiVoiceClip, REF_TEXT } from "@/lib/ai/tts";
import { houseVoices, isHouseVoice, needsRef, needsSample, refPath, sampleKey, speedOf, VOICE_ID_RE } from "@/lib/reels/voices";
import { UUID_RE } from "./helpers";
import { fail, requireOwner, type ActionResult } from "./result";

type SB = Awaited<ReturnType<typeof createClient>>;
type DbError = { message: string; code?: string };

// A "use server" file may only export async functions (and types): limits stay local.
/** Set up voices runs from Settings (maxDuration 300): stop starting clips after this. */
const SETUP_BUDGET_MS = 270_000;
/** Below this, another Gemini clip can't finish in time: return and let the page call again. */
const CLIP_MIN_MS = 20_000;
const CLIP_MAX_MS = 60_000;
/** Gemini clips made at the same time. */
const PARALLEL = 3;
const BUCKET = "reels";

const NEEDS_006 = "Narrator voices need the database update first (run supabase/migrations/006_reel_voices.sql).";
const NOT_FOUND = "Reel not found.";

const missing006 = (e: DbError) =>
  e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204" || e.code === "42703" ||
  /relation .* does not exist|schema cache/i.test(e.message);
const dbFail = (e: DbError) => fail(missing006(e) ? NEEDS_006 : e.message);

async function getVoices(sb: SB): Promise<{ voices: ReelVoiceRow[]; error?: DbError }> {
  const { data, error } = await sb.from("reel_voices").select("*").order("id");
  return { voices: (data ?? []) as ReelVoiceRow[], error: error ?? undefined };
}

/** The saved narration speed (1.00 before migration 006: the old worker never speeds the voice up). */
async function savedSpeed(sb: SB): Promise<number> {
  const { data } = await sb.from("settings").select("*").eq("id", 1).maybeSingle();
  const v = (data as { reel_speed?: unknown } | null)?.reel_speed;
  return v === undefined || v === null ? 1 : speedOf(v);
}

/** Back in line for the PC (version bumped: a sample being made for the old version is discarded). */
const queueSample = (sb: SB, v: ReelVoiceRow, extra: Record<string, unknown> = {}) =>
  sb.from("reel_voices").update({ ...extra, sample_status: "queued", error: null, claimed_at: null, version: v.version + 1 })
    .eq("id", v.id).eq("version", v.version).select("id");

/** Storage says the file is already there (a run that uploaded it, then stopped before saving the row). */
const alreadyThere = (e: { message?: string; statusCode?: string | number } | null) =>
  !!e && (String(e.statusCode) === "409" || /already exists|duplicate/i.test(e.message ?? ""));

/**
 * "Set up voices" (one time): a Gemini reference clip for every house voice that has none, uploaded to
 * voices/<id>/ref.wav (insert only), then the voice's sample goes in line for the PC. Voices that
 * already have a clip are skipped, so it is safe to run again. Stops starting clips after ~270 s and
 * returns what is left: the page calls again until `remaining` is 0. Other voices are left alone (2.6.0).
 */
export async function setUpVoicesAction(): Promise<ActionResult<{ made: number; skipped: number; remaining: number; failed: number; lastError?: string }>> {
  await requireOwner();
  const deadline = Date.now() + SETUP_BUDGET_MS;
  const sb = await createClient();
  const { voices: all, error } = await getVoices(sb);
  if (error) return dbFail(error);
  if (!process.env.GEMINI_API_KEY?.trim()) return fail("GEMINI_API_KEY is not set.");
  const voices = houseVoices(all);
  const todo = voices.filter(needsRef);
  const skipped = voices.length - todo.length;
  let made = 0, failed = 0, lastError: string | undefined;
  const queue = [...todo];
  const one = async (v: ReelVoiceRow): Promise<void> => {
    const left = deadline - Date.now();
    const clip = await geminiVoiceClip(v.label, REF_TEXT, Math.min(CLIP_MAX_MS, left));
    if (!clip.ok) { failed++; lastError = `${v.label}: ${clip.error}`; return; }
    const path = refPath(v.id);
    const { error: ue } = await sb.storage.from(BUCKET).upload(path, clip.wav, { contentType: "audio/wav", upsert: false });
    if (ue && !alreadyThere(ue as { message?: string; statusCode?: string })) { failed++; lastError = `${v.label}: ${ue.message}`; return; }
    const { data, error: we } = await queueSample(sb, v, { ref_path: path });
    if (we) { failed++; lastError = `${v.label}: ${we.message}`; return; }
    if (data?.length) made++;
  };
  const worker = async () => {
    for (;;) {
      if (deadline - Date.now() < CLIP_MIN_MS) return;
      const v = queue.shift();
      if (!v) return;
      await one(v);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, Math.max(1, queue.length)) }, worker));

  const { voices: after, error: re } = await getVoices(sb);
  const remaining = re ? todo.length - made : houseVoices(after).filter(needsRef).length;
  revalidatePath("/settings");
  return { ok: true, made, skipped, remaining, failed, ...(lastError ? { lastError } : {}) };
}

/**
 * "Make samples": every set-up house voice with no sample, a failed one, or one made with other delivery/speed
 * settings than the saved ones goes in line; the PC makes them when it has nothing else to do.
 */
export async function queueVoiceSamplesAction(): Promise<ActionResult<{ queued: number; notSetUp: number }>> {
  await requireOwner();
  const sb = await createClient();
  const [{ voices: all, error }, speed] = await Promise.all([getVoices(sb), savedSpeed(sb)]);
  if (error) return dbFail(error);
  const voices = houseVoices(all);
  const key = sampleKey(speed);
  const todo = voices.filter((v) => needsSample(v, key));
  const results = await Promise.all(todo.map((v) => queueSample(sb, v)));
  const bad = results.find((r) => r.error)?.error;
  if (bad) return dbFail(bad);
  revalidatePath("/settings");
  return { ok: true, queued: results.filter((r) => r.data?.length).length, notSetUp: voices.filter(needsRef).length };
}

/**
 * The review page's narrator for one reel (null = the Settings default; otherwise one of the house voices). Only
 * while the script is waiting for review: nothing has been spoken yet, so nothing else changes.
 */
export async function setReelVoiceAction(reelId: string, voiceId: string | null): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(reelId ?? "")) return fail(NOT_FOUND);
  if (voiceId !== null && (typeof voiceId !== "string" || !VOICE_ID_RE.test(voiceId) || !isHouseVoice(voiceId))) return fail("Pick a voice from the list.");
  const sb = await createClient();
  const { data, error } = await sb.from("reels").select("*").eq("id", reelId).maybeSingle();
  if (error) return dbFail(error);
  const reel = data as ReelRow | null;
  if (!reel) return fail(NOT_FOUND);
  if (reel.status !== "script") return fail("The narrator can only be changed before you approve the script.");
  if (voiceId !== null) {
    const { data: v, error: ve } = await sb.from("reel_voices").select("id, ref_path").eq("id", voiceId).maybeSingle();
    if (ve) return dbFail(ve);
    if (!v) return fail("Pick a voice from the list.");
    if (needsRef(v as Pick<ReelVoiceRow, "id" | "ref_path">)) return fail("That voice isn't set up yet. Tap Set up voices in Settings.");
  }
  // A new voice means a new voice track, timing and music bed (all still empty while in script).
  const { data: u, error: ue } = await sb.from("reels")
    .update({ voice_id: voiceId, voice_path: null, words: null, music_path: null, preview_path: null, version: reel.version + 1 })
    .eq("id", reelId).eq("version", reel.version).eq("status", "script").select("id");
  if (ue) return ue.code === "23503" ? fail("Pick a voice from the list.") : dbFail(ue);
  if (!u?.length) return fail("This reel just changed. Reload the page and try again.");
  revalidatePath("/reels", "layout");
  return { ok: true };
}
