import type { ReelVoiceRow, VoiceSampleStatus } from "@/lib/db/types";

// Pure helpers for the narrator voices (no React, no server): the house voices, the Chatterbox delivery, the
// sample key (what a sample was made with), speed / volume limits, and which voices need work.
// Shared by the server actions, the Settings section and the review page picker.

/**
 * The retuned Chatterbox delivery (worker 2.6.0, the owner's pick in the 2026-10-10 listening test: the narration is
 * voiced line by line with room tone between the lines). Was the calm 0.35 / 0.7 / 0.5.
 */
export const DELIVERY = { exaggeration: 0.6, temperature: 0.8, cfg_weight: 0.3 } as const;

/**
 * The house voices (worker voice.HOUSE_VOICES): the only narrators offered in Settings, on the review page and in
 * Set up voices / Make samples. The other Gemini voices (and the built-in one) stay in the database, hidden.
 */
export const HOUSE_VOICES = [
  { id: "gacrux", label: "Gacrux", tone: "Mature" },
  { id: "sulafat", label: "Sulafat", tone: "Warm" },
  { id: "vindemiatrix", label: "Vindemiatrix", tone: "Gentle" },
  { id: "achernar", label: "Achernar", tone: "Soft" },
] as const;
const HOUSE_IDS: readonly string[] = HOUSE_VOICES.map((v) => v.id);

/** Narration speed (ffmpeg atempo). */
export const SPEED_MIN = 1;
export const SPEED_MAX = 1.25;
export const SPEED_STEP = 0.01;
/** Calmer from migration 014 on (was 1.12). */
export const SPEED_DEFAULT = 1.05;
/** Music volume in % of the normalized bed. */
export const VOLUME_MIN = 5;
export const VOLUME_MAX = 40;
export const VOLUME_DEFAULT = 18;
export const MUSIC_DEFAULT = true;
/** The default narrator (a Settings narrator outside the house voices counts as this one). */
export const VOICE_DEFAULT = "gacrux";
export const BUILTIN = "builtin";

/** Two decimals, like the numeric(3,2) column (a slider step of 0.01 can give 1.1300000000000001). */
export const roundSpeed = (v: number) => Math.round(v * 100) / 100;
/** A stored speed (number or numeric string) in range, or the default. */
export function speedOf(v: unknown): number {
  const n = roundSpeed(Number(v));
  return Number.isFinite(n) && n >= SPEED_MIN && n <= SPEED_MAX ? n : SPEED_DEFAULT;
}
/** "1.05×". */
export const speedLabel = (v: number) => `${roundSpeed(v).toFixed(2)}×`;

/**
 * The settings a sample is made with, e.g. "e0.6-t0.8-c0.3-s1.00-l1". The PC worker writes this exact
 * string to reel_voices.sample_key when it saves a sample; a different key = the sample is stale.
 * "-l1" = the line-by-line voice (edge trims, room tone; worker 2.6.0): samples made before it ("-g1") are stale.
 */
export const sampleKey = (speed: number) =>
  `e${DELIVERY.exaggeration}-t${DELIVERY.temperature}-c${DELIVERY.cfg_weight}-s${roundSpeed(speed).toFixed(2)}-l1`;

/** One of the 4 house voices. */
export const isHouseVoice = (id: string | null | undefined): boolean => !!id && HOUSE_IDS.includes(id);
/** The narrator to use / show for a stored default: itself when it is a house voice, else Gacrux. */
export const houseDefault = (id: string | null | undefined): string => (isHouseVoice(id) ? id! : VOICE_DEFAULT);
/** Only the house voices' rows, in house order (Gacrux first). */
export const houseVoices = <T extends { id: string }>(rows: readonly T[]): T[] =>
  rows.filter((v) => isHouseVoice(v.id)).sort((a, b) => HOUSE_IDS.indexOf(a.id) - HOUSE_IDS.indexOf(b.id));

/** The reference clip path in the reels bucket (the storage policy allows exactly this shape). */
export const refPath = (id: string) => `voices/${id}/ref.wav`;
/** Voice ids are the Gemini name in lower case (letters only) or 'builtin'. */
export const VOICE_ID_RE = /^[a-z]{2,40}$/;

type VoiceLike = Pick<ReelVoiceRow, "id" | "ref_path" | "sample_status" | "sample_key">;

/** Chatterbox can speak with this voice: it has a reference clip, or it is the built-in voice. */
export const isSetUp = (v: Pick<ReelVoiceRow, "id" | "ref_path">) => v.id === BUILTIN || !!v.ref_path;
/** A Gemini voice still waiting for its reference clip (Set up voices). */
export const needsRef = (v: Pick<ReelVoiceRow, "id" | "ref_path">) => !isSetUp(v);
/** A ready sample made with other settings than `key`. */
export const isStale = (v: VoiceLike, key: string) => v.sample_status === "ready" && v.sample_key !== key;
/** Make samples queues it: set up, and no sample yet, a failed one, or a stale one (never one in line / being made). */
export const needsSample = (v: VoiceLike, key: string) =>
  isSetUp(v) && (v.sample_status === "missing" || v.sample_status === "failed" || isStale(v, key));

/** Badge text + tone per sample status (the grid and the picker). */
export const SAMPLE_LABEL: Record<VoiceSampleStatus, { label: string; tone: "ok" | "muted" | "accent" | "bad" }> = {
  missing: { label: "No sample", tone: "muted" },
  queued: { label: "In line", tone: "muted" },
  making: { label: "Making…", tone: "accent" },
  ready: { label: "Ready", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
};

/** Built-in first, then by label. */
export const byVoiceOrder = (a: Pick<ReelVoiceRow, "id" | "label">, b: Pick<ReelVoiceRow, "id" | "label">) =>
  a.id === BUILTIN ? -1 : b.id === BUILTIN ? 1 : a.label.localeCompare(b.label);
