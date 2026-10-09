import "server-only";
import { geminiHttpError } from "@/lib/ai/gemini";

/** Newest GA Gemini TTS model (spike 2026-10-06); it answers with a complete WAV file. */
export const TTS_MODEL = "gemini-3.8-flash-tts";
/** The ~10 s reference clip Chatterbox clones each Gemini voice from (spec). */
export const REF_TEXT = "Hello, mama. Every little moment with your baby matters. Let's take a deep breath, slow down, and enjoy it together.";
const endpoint = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const RETRY_DELAY_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 429 || status >= 500;

export type VoiceClipResult = { ok: true; wav: Buffer } | { ok: false; error: string };

interface TtsResponse {
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/** A 44-byte WAV header + 16-bit little-endian PCM. */
export function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const h = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);        // fmt chunk size
  h.writeUInt16LE(1, 20);         // PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);        // bits per sample
  h.write("data", 36, "ascii");
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * Gemini's audio as a WAV file. `audio/wav` is already a complete file (gemini-3.8-flash-tts): kept
 * as-is (wrapping it again leaves a header click). Raw `audio/L16;codec=pcm;rate=24000` (older
 * models) gets a WAV header at its rate (24 kHz mono by default).
 */
export function toWav(mimeType: string, data: Buffer): Buffer | null {
  const mt = mimeType.toLowerCase();
  if (mt.startsWith("audio/wav") || mt.startsWith("audio/x-wav") || mt.startsWith("audio/wave")) {
    return data.subarray(0, 4).toString("ascii") === "RIFF" ? data : null;
  }
  if (mt.startsWith("audio/l16") || mt.includes("pcm")) {
    const rate = Number(/rate=(\d+)/.exec(mt)?.[1] ?? 24000);
    return pcmToWav(data, Number.isFinite(rate) && rate > 0 ? rate : 24000);
  }
  return null;
}

/**
 * One spoken clip of `text` in a Gemini prebuilt voice (e.g. "Gacrux"), as a WAV file. Never throws,
 * never logs or returns the key (it travels in a header). One retry on 429/5xx or a network error
 * while the time budget allows; a timeout is not retried.
 */
export async function geminiVoiceClip(voice: string, text: string, timeoutMs = 60_000): Promise<VoiceClipResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { ok: false, error: "GEMINI_API_KEY is not set." };
  const deadline = Date.now() + timeoutMs;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });
  let lastError = "Gemini did not answer.";
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) return { ok: false, error: "Gemini timed out." };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), left);
    let res: Response;
    let json: TtsResponse | null = null;
    try {
      res = await fetch(endpoint(TTS_MODEL), {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body, signal: ctrl.signal,
      });
      try { json = (await res.json()) as TtsResponse; } catch { json = null; }
    } catch (e) {
      clearTimeout(timer);
      if (ctrl.signal.aborted) return { ok: false, error: "Gemini timed out." };
      lastError = `Could not reach Gemini (${e instanceof Error ? e.name : "network error"}).`;
      if (attempt === 0 && deadline - Date.now() > RETRY_DELAY_MS) { await sleep(RETRY_DELAY_MS); continue; }
      return { ok: false, error: lastError };
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      lastError = geminiHttpError(res.status, json?.error?.message);
      if (attempt === 0 && retryable(res.status) && deadline - Date.now() > RETRY_DELAY_MS) { await sleep(RETRY_DELAY_MS); continue; }
      return { ok: false, error: lastError };
    }
    return readAudio(json);
  }
  return { ok: false, error: lastError };
}

function readAudio(json: TtsResponse | null): VoiceClipResult {
  if (!json) return { ok: false, error: "Gemini sent an unreadable response." };
  if (json.promptFeedback?.blockReason) return { ok: false, error: `Gemini blocked the request (${json.promptFeedback.blockReason}).` };
  const cand = json.candidates?.[0];
  const audio = (cand?.content?.parts ?? []).map((p) => p.inlineData).find((d) => d?.data);
  if (!audio?.data) return { ok: false, error: `Gemini returned no audio${cand?.finishReason ? ` (${cand.finishReason})` : ""}.` };
  const wav = toWav(audio.mimeType ?? "", Buffer.from(audio.data, "base64"));
  if (!wav || wav.length <= 44) return { ok: false, error: `Gemini returned audio in an unknown format (${(audio.mimeType ?? "none").slice(0, 60)}).` };
  return { ok: true, wav };
}
