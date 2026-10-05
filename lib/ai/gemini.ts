import "server-only";

/** The one Gemini model the app uses (captions now, name/theme suggestions next). */
export const GEMINI_MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/** Gemini's OpenAPI-subset schema (types are upper-case: OBJECT, ARRAY, STRING, INTEGER, BOOLEAN). */
export interface GeminiSchema {
  type: "OBJECT" | "ARRAY" | "STRING" | "INTEGER" | "NUMBER" | "BOOLEAN";
  description?: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
  enum?: string[];
  maxItems?: number;
  minItems?: number;
}

export interface GenerateJsonInput<T> {
  system: string;
  prompt: string;
  schema: GeminiSchema;
  temperature?: number;
  /** Whole budget for the call, retry included. */
  timeoutMs?: number;
  /** Optional shape check; return null to reject the model's JSON. */
  parse?: (raw: unknown) => T | null;
  /** Gemini 2.5 "thinking" tokens; 0 turns thinking off (fast, cheap). Default 0. */
  thinkingBudget?: number;
}

export type GenerateJsonResult<T> = { ok: true; data: T } | { ok: false; error: string };

const RETRY_DELAY_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 429 || status >= 500;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/**
 * Ask Gemini for JSON matching `schema`. Never throws, never logs or returns the key
 * (it travels in a header, not the URL). One retry on 429/5xx or a network error while
 * the time budget allows; a timeout is not retried.
 */
export async function generateJson<T>(input: GenerateJsonInput<T>): Promise<GenerateJsonResult<T>> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { ok: false, error: "GEMINI_API_KEY is not set." };
  const timeoutMs = input.timeoutMs ?? 20000;
  const deadline = Date.now() + timeoutMs;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: input.system }] },
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: input.schema,
      temperature: input.temperature ?? 0.9,
      thinkingConfig: { thinkingBudget: input.thinkingBudget ?? 0 },
    },
  });

  let lastError = "Gemini did not answer.";
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) return { ok: false, error: "Gemini timed out." };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), left);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body,
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (ctrl.signal.aborted) return { ok: false, error: "Gemini timed out." };
      lastError = `Could not reach Gemini (${e instanceof Error ? e.name : "network error"}).`;
      if (attempt === 0 && deadline - Date.now() > RETRY_DELAY_MS) { await sleep(RETRY_DELAY_MS); continue; }
      return { ok: false, error: lastError };
    }
    let json: GeminiResponse | null = null;
    try {
      json = (await res.json()) as GeminiResponse;
    } catch {
      json = null;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      lastError = `Gemini error ${res.status}${json?.error?.message ? `: ${json.error.message.slice(0, 200)}` : ""}`;
      if (attempt === 0 && retryable(res.status) && deadline - Date.now() > RETRY_DELAY_MS) { await sleep(RETRY_DELAY_MS); continue; }
      return { ok: false, error: lastError };
    }
    if (ctrl.signal.aborted) return { ok: false, error: "Gemini timed out." };
    return readJson(json, input.parse);
  }
  return { ok: false, error: lastError };
}

function readJson<T>(json: GeminiResponse | null, parse?: (raw: unknown) => T | null): GenerateJsonResult<T> {
  if (!json) return { ok: false, error: "Gemini sent an unreadable response." };
  if (json.promptFeedback?.blockReason) return { ok: false, error: `Gemini blocked the request (${json.promptFeedback.blockReason}).` };
  const cand = json.candidates?.[0];
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
  if (!text) return { ok: false, error: `Gemini returned no text${cand?.finishReason ? ` (${cand.finishReason})` : ""}.` };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Gemini returned invalid JSON." };
  }
  if (!parse) return { ok: true, data: raw as T };
  const data = parse(raw);
  return data === null ? { ok: false, error: "Gemini returned JSON in the wrong shape." } : { ok: true, data };
}
