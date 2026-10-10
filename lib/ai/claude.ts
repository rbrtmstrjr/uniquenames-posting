import "server-only";
import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import type { GeminiSchema, GenerateJsonResult } from "./gemini";
import { toClaudeSchema } from "./json-schema";

/** Fast, cheap ($0.10 / $0.50 per MTok): captions, suggestions and (by default) reel scripts. */
export const CLAUDE_HAIKU = "claude-haiku-5-5";
/** Stronger writer ($2 / $10 per MTok): reel scripts when AI_SCRIPT_MODEL=sonnet. */
export const CLAUDE_SONNET = "claude-sonnet-5-5";
/** Most capable ($4 / $20 per MTok; thinking always on): reel scripts when AI_SCRIPT_MODEL=opus. */
export const CLAUDE_OPUS = "claude-opus-5-5";
/** Room for adaptive thinking plus the JSON (a reel script is ~3-5K tokens); safe without streaming. */
export const CLAUDE_MAX_TOKENS = 16000;

export type ClaudeEffort = "low" | "medium" | "high";

export interface ClaudeJsonInput<T> {
  system: string;
  prompt: string;
  /** The callers' Gemini-dialect schema; converted to JSON Schema here. */
  schema: GeminiSchema;
  /** Whole budget for the call, retry included. Default 20 s. */
  timeoutMs?: number;
  /** Optional shape check; return null to reject the model's JSON. */
  parse?: (raw: unknown) => T | null;
  /** Model id; default CLAUDE_HAIKU. */
  model?: string;
  /** How hard the model thinks (Claude has no temperature on these models). Default "medium". */
  effort?: ClaudeEffort;
}

/** Shown instead of the API's billing error: the prepaid balance is empty and every AI button fails until it is topped up. */
export const CLAUDE_CREDITS_OUT =
  "Your Claude credits have run out. Top up in the Claude Console (Billing), then try again.";

/** The API's own message inside an error body ({ error: { message } }), else the SDK's. */
function apiMessage(e: APIError): string {
  const inner = (e.error as { error?: { message?: unknown } } | undefined)?.error?.message;
  return typeof inner === "string" ? inner : e.message;
}

/** A friendly error for a failed call. Never includes the key. */
export function claudeError(e: unknown, timedOut: boolean): string {
  if (timedOut || e instanceof APIUserAbortError || e instanceof APIConnectionTimeoutError) return "Claude timed out.";
  if (e instanceof APIConnectionError) return "Could not reach Claude (network error).";
  if (e instanceof APIError && typeof e.status === "number") {
    const msg = apiMessage(e);
    if (e.status === 402 || (e.status === 400 && /credit balance/i.test(msg))) return CLAUDE_CREDITS_OUT;
    if (e.status === 401) return "Claude rejected the API key (401). Check ANTHROPIC_API_KEY.";
    if (e.status === 403) return "This Claude key is not allowed to do that (403).";
    if (e.status === 404) return `Claude does not know that model (404): ${msg.slice(0, 120)}`;
    if (e.status === 429) return "Claude is rate-limiting requests (429). Wait a minute and try again.";
    if (e.status >= 500) return `Claude is busy or having trouble (${e.status}). Try again shortly.`;
    return `Claude error ${e.status}: ${msg.slice(0, 200)}`;
  }
  return `Claude failed (${e instanceof Error ? e.name : "unknown error"}).`;
}

function readMessage<T>(msg: Anthropic.Message, parse?: (raw: unknown) => T | null): GenerateJsonResult<T> {
  if (msg.stop_reason === "refusal") return { ok: false, error: "Claude declined to write this (refusal). Try a different topic or wording." };
  if (msg.stop_reason === "max_tokens") return { ok: false, error: "Claude ran out of room (max_tokens) before finishing. Try again." };
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  if (!text) return { ok: false, error: "Claude returned no text." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Claude returned invalid JSON." };
  }
  if (!parse) return { ok: true, data: raw as T };
  const data = parse(raw);
  return data === null ? { ok: false, error: "Claude returned JSON in the wrong shape." } : { ok: true, data };
}

/**
 * Ask Claude for JSON matching `schema` (structured outputs: the answer is constrained to the schema).
 * Same result shape as generateJson. Never throws; the key comes from ANTHROPIC_API_KEY only and is never
 * logged or returned. The SDK retries a 429 / 5xx / network error once while the deadline allows.
 */
export async function claudeJson<T>(input: ClaudeJsonInput<T>): Promise<GenerateJsonResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
  const timeoutMs = input.timeoutMs ?? 20000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // authToken: null so a stray ANTHROPIC_AUTH_TOKEN never adds a second auth header (401).
    const client = new Anthropic({ apiKey, authToken: null, maxRetries: 1, timeout: timeoutMs });
    const msg = await client.messages.create(
      {
        model: input.model ?? CLAUDE_HAIKU,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: input.system,
        messages: [{ role: "user", content: input.prompt }],
        // No temperature / thinking params: these models reject sampling params and think adaptively by default.
        output_config: { effort: input.effort ?? "medium", format: { type: "json_schema", schema: toClaudeSchema(input.schema) } },
      },
      { signal: ctrl.signal },
    );
    return readMessage(msg, input.parse);
  } catch (e) {
    return { ok: false, error: claudeError(e, ctrl.signal.aborted) };
  } finally {
    clearTimeout(timer);
  }
}
