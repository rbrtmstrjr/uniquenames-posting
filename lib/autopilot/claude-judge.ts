import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_CREDITS_OUT, CLAUDE_OPUS, claudeError } from "@/lib/ai/claude";
import { toClaudeSchema } from "@/lib/ai/json-schema";
import type { GeminiSchema } from "@/lib/ai/gemini";

// Autopilot's checks (names, photos, look-alikes): Claude Opus 5.5, the sharpest at small details, with a JSON answer
// constrained to a schema. The server-side refusal fallback is on: if Opus declines (a rare false positive on child
// photos), the API re-runs the same request on its fallback model inside the same call.

export const JUDGE_MODEL = CLAUDE_OPUS;
export const JUDGE_EFFORT = "medium" as const;
const MAX_TOKENS = 16000;

export interface Usage { input: number; output: number }
export type JudgeResult<T> = { ok: true; data: T; usage: Usage } | { ok: false; error: string; usage: Usage; stop: boolean };

/** Errors that stop the whole run until the owner fixes something (credits, key). */
export const isStopError = (msg: string) => msg === CLAUDE_CREDITS_OUT || /\((401|403)\)/.test(msg) || /ANTHROPIC_API_KEY is not set/.test(msg);

export async function judgeJson<T>(i: {
  system: string; content: Anthropic.Beta.Messages.BetaContentBlockParam[]; schema: GeminiSchema; parse: (raw: unknown) => T | null; timeoutMs?: number;
}): Promise<JudgeResult<T>> {
  const zero: Usage = { input: 0, output: 0 };
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not set in Vercel.", usage: zero, stop: true };
  const timeoutMs = i.timeoutMs ?? 90_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // authToken: null so a stray ANTHROPIC_AUTH_TOKEN never adds a second auth header (401).
    const client = new Anthropic({ apiKey, authToken: null, maxRetries: 1, timeout: timeoutMs });
    const msg = await client.beta.messages.create({
      model: JUDGE_MODEL, max_tokens: MAX_TOKENS,
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      system: i.system,
      messages: [{ role: "user", content: i.content }],
      output_config: { effort: JUDGE_EFFORT, format: { type: "json_schema", schema: toClaudeSchema(i.schema) } },
    }, { signal: ctrl.signal });
    const u = msg.usage;
    const usage: Usage = { input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens };
    if (msg.stop_reason === "refusal") return { ok: false, error: "Claude declined to check this.", usage, stop: false };
    if (msg.stop_reason === "max_tokens") return { ok: false, error: "Claude ran out of room before finishing.", usage, stop: false };
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return { ok: false, error: "Claude returned invalid JSON.", usage, stop: false }; }
    const data = i.parse(raw);
    return data === null ? { ok: false, error: "Claude returned JSON in the wrong shape.", usage, stop: false } : { ok: true, data, usage };
  } catch (e) {
    const error = claudeError(e, ctrl.signal.aborted);
    return { ok: false, error, usage: zero, stop: isStopError(error) };
  } finally {
    clearTimeout(timer);
  }
}
