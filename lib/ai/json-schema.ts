import type { GeminiSchema } from "./gemini";

/** A JSON Schema node as Claude structured outputs accept it. */
export type ClaudeSchema = Record<string, unknown>;

/**
 * Gemini's OpenAPI-subset schema (OBJECT / STRING, `nullable`, `maxItems`, …) as the standard JSON Schema
 * Claude structured outputs accept: lower-case types, `nullable` as a null type (anyOf for enums and
 * objects), every object closed (`additionalProperties: false`) with every property required (a property
 * the Gemini schema left optional becomes nullable instead), and the constraints Claude does not support
 * (maxItems, minItems above 1, propertyOrdering, …) dropped: the callers' own validators still check them.
 * Pure; never changes its input.
 */
export function toClaudeSchema(s: GeminiSchema): ClaudeSchema {
  const { nullable, description } = s;
  const core: ClaudeSchema = { type: s.type.toLowerCase() };
  if (s.enum) core.enum = [...s.enum];
  if (s.type === "OBJECT") {
    const props = s.properties ?? {};
    const required = new Set(s.required ?? []);
    core.properties = Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, toClaudeSchema(required.has(k) ? v : { ...v, nullable: true })]),
    );
    core.required = Object.keys(props);
    core.additionalProperties = false;
  }
  if (s.type === "ARRAY" && s.items) {
    core.items = toClaudeSchema(s.items);
    if (s.minItems === 0 || s.minItems === 1) core.minItems = s.minItems;
  }
  if (!nullable) return description ? { ...core, description } : core;
  if (s.type !== "OBJECT" && s.type !== "ARRAY" && !s.enum) {
    return { ...core, type: [core.type, "null"], ...(description ? { description } : {}) };
  }
  return { ...(description ? { description } : {}), anyOf: [core, { type: "null" }] };
}
