import "server-only";
import { generateJson, type GenerateJsonInput, type GenerateJsonResult } from "./gemini";
import { claudeJson, CLAUDE_HAIKU, CLAUDE_SONNET, type ClaudeEffort } from "./claude";

/** "script" = a reel script (long, careful); "small" = captions and name / theme / letter suggestions. */
export type AiTask = "script" | "small";
export type AiJsonInput<T> = GenerateJsonInput<T> & { task: AiTask };

/** Which AI writes the text: Gemini unless AI_PROVIDER=claude (explicit only; no automatic fallback). */
export function aiProvider(): "gemini" | "claude" {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === "claude" ? "claude" : "gemini";
}

/** The Claude model for a task: Haiku, except scripts with AI_SCRIPT_MODEL=sonnet (or the full Sonnet id). */
export function claudeModelFor(task: AiTask): string {
  if (task !== "script") return CLAUDE_HAIKU;
  const want = process.env.AI_SCRIPT_MODEL?.trim().toLowerCase();
  return want === "sonnet" || want === CLAUDE_SONNET ? CLAUDE_SONNET : CLAUDE_HAIKU;
}

const EFFORT: Record<AiTask, ClaudeEffort> = { script: "medium", small: "low" };

/**
 * JSON from the configured AI. Gemini gets the call exactly as before; Claude gets the same prompt, schema,
 * budget and shape check with the task's model and effort (Gemini's temperature, thinking and model id do
 * not apply to it). Never throws.
 */
export function aiJson<T>(input: AiJsonInput<T>): Promise<GenerateJsonResult<T>> {
  const { task, ...rest } = input;
  if (aiProvider() !== "claude") return generateJson<T>(rest);
  const { system, prompt, schema, timeoutMs, parse } = rest;
  return claudeJson<T>({ system, prompt, schema, timeoutMs, parse, model: claudeModelFor(task), effort: EFFORT[task] });
}
