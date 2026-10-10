import { describe, expect, it } from "vitest";
import { toClaudeSchema } from "@/lib/ai/json-schema";
import { schemaFor } from "@/lib/ai/reel-script";
import { CAPTION_SCHEMA } from "@/lib/ai/caption-core";
import type { GeminiSchema } from "@/lib/ai/gemini";

type Json = Record<string, unknown>;

/** Every object node in a converted schema (walks properties, items and anyOf). */
function objects(s: Json, out: Json[] = []): Json[] {
  if (s.type === "object" || (Array.isArray(s.type) && s.type.includes("object"))) out.push(s);
  for (const p of Object.values((s.properties as Record<string, Json>) ?? {})) objects(p, out);
  if (s.items) objects(s.items as Json, out);
  for (const a of (s.anyOf as Json[]) ?? []) objects(a, out);
  return out;
}

/** Every key used anywhere in the schema (property names excluded). */
function keywords(s: Json, out = new Set<string>()): Set<string> {
  for (const [k, v] of Object.entries(s)) {
    out.add(k);
    if (k === "properties") for (const p of Object.values(v as Record<string, Json>)) keywords(p, out);
    else if (k === "items") keywords(v as Json, out);
    else if (k === "anyOf") for (const a of v as Json[]) keywords(a, out);
  }
  return out;
}

const ALLOWED = new Set(["type", "description", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "minItems"]);

describe("toClaudeSchema", () => {
  it("lower-cases types and keeps descriptions and enums", () => {
    expect(toClaudeSchema({ type: "STRING", description: "d", enum: ["a", "b"] })).toEqual({ type: "string", description: "d", enum: ["a", "b"] });
    expect(toClaudeSchema({ type: "INTEGER" })).toEqual({ type: "integer" });
    expect(toClaudeSchema({ type: "NUMBER" })).toEqual({ type: "number" });
    expect(toClaudeSchema({ type: "BOOLEAN" })).toEqual({ type: "boolean" });
  });

  it("closes every object and requires every property; optional ones become nullable", () => {
    const s = toClaudeSchema({
      type: "OBJECT",
      properties: { a: { type: "STRING" }, b: { type: "INTEGER" } },
      required: ["a"],
    });
    expect(s).toEqual({
      type: "object",
      properties: { a: { type: "string" }, b: { type: ["integer", "null"] } },
      required: ["a", "b"],
      additionalProperties: false,
    });
  });

  it("turns nullable into a null type (anyOf for enums and objects)", () => {
    expect(toClaudeSchema({ type: "STRING", nullable: true, description: "x" })).toEqual({ type: ["string", "null"], description: "x" });
    expect(toClaudeSchema({ type: "STRING", nullable: true, enum: ["a"] })).toEqual({ anyOf: [{ type: "string", enum: ["a"] }, { type: "null" }] });
    const obj = toClaudeSchema({ type: "OBJECT", nullable: true, description: "o", properties: { a: { type: "STRING" } }, required: ["a"] });
    expect(obj).toEqual({
      description: "o",
      anyOf: [{ type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false }, { type: "null" }],
    });
  });

  it("drops unsupported constraints (maxItems, minItems > 1, unknown Gemini keys)", () => {
    const s = toClaudeSchema({ type: "ARRAY", items: { type: "STRING" }, maxItems: 5, minItems: 3, propertyOrdering: ["x"] } as GeminiSchema);
    expect(s).toEqual({ type: "array", items: { type: "string" } });
    expect(toClaudeSchema({ type: "ARRAY", items: { type: "STRING" }, minItems: 1 })).toEqual({ type: "array", items: { type: "string" }, minItems: 1 });
  });

  it("does not change the Gemini schema it is given", () => {
    const g: GeminiSchema = { type: "OBJECT", properties: { a: { type: "STRING", nullable: true } }, required: ["a"] };
    const before = JSON.stringify(g);
    toClaudeSchema(g);
    expect(JSON.stringify(g)).toBe(before);
  });

  it.each(["crayon", "redthread", "knitted"])("converts the real reel-script schema (%s)", (theme) => {
    const g = schemaFor(theme);
    const s = toClaudeSchema(g) as Json;
    for (const o of objects(s)) {
      expect(o.additionalProperties).toBe(false);
      expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as Json).sort());
    }
    for (const k of keywords(s)) expect(ALLOWED.has(k), k).toBe(true);
    const scene = ((s.properties as Record<string, Json>).scenes.items as Json).properties as Record<string, Json>;
    expect(scene.on_screen.type).toEqual(["string", "null"]);
    expect(scene.time_jump.type).toBe("boolean");
    expect(scene.beat.enum).toEqual(["hook", "build", "turn", "close"]);
    expect(JSON.stringify(s)).not.toMatch(/"(?:OBJECT|ARRAY|STRING|INTEGER|NUMBER|BOOLEAN)"/);
  });

  it("converts the caption schema (maxItems dropped, both fields required)", () => {
    const s = toClaudeSchema(CAPTION_SCHEMA(3)) as Json;
    expect(s).toEqual({
      type: "object",
      properties: {
        caption: { type: "string", description: "The Facebook caption, no hashtags" },
        tags: { type: "array", items: { type: "string" }, description: "Hashtags, lowercase, best first" },
      },
      required: ["caption", "tags"],
      additionalProperties: false,
    });
  });
});
