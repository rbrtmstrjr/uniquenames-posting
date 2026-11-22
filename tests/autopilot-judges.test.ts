import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake Anthropic client behind the real SDK's error classes (lib/ai/claude.ts uses them).
const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", async (real) => {
  const mod = await real<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic { beta = { messages: { create } }; messages = { create }; }
  return { ...mod, default: FakeAnthropic };
});
const { judgeJson, isStopError } = await import("@/lib/autopilot/claude-judge");
const { judgeNames } = await import("@/lib/autopilot/judge-names");
const { judgeCard, judgeLookAlike } = await import("@/lib/autopilot/judge-photos");
const { parsePhotoVerdict, parseLookAlike } = await import("@/lib/autopilot/photo-problems");
const { CLAUDE_CREDITS_OUT } = await import("@/lib/ai/claude");
const { APIError, APIConnectionTimeoutError } = await import("@anthropic-ai/sdk");

const answer = (json: unknown, o: { stop?: string; input?: number; output?: number } = {}) => ({
  stop_reason: o.stop ?? "end_turn", content: [{ type: "text", text: JSON.stringify(json) }],
  usage: { input_tokens: o.input ?? 1000, output_tokens: o.output ?? 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});

beforeEach(() => { create.mockReset(); process.env.ANTHROPIC_API_KEY = "sk-test"; });

describe("judgeJson", () => {
  it("asks Claude Opus 5.5 with the JSON schema, the refusal fallback and medium effort, and counts tokens", async () => {
    create.mockResolvedValueOnce(answer({ remake: [] }, { input: 1600, output: 300 }));
    const r = await judgeJson({ system: "s", content: [{ type: "text", text: "t" }], schema: { type: "OBJECT", properties: { remake: { type: "ARRAY", items: { type: "INTEGER" } } }, required: ["remake"] }, parse: (x) => x });
    expect(r).toEqual({ ok: true, data: { remake: [] }, usage: { input: 1600, output: 300 } });
    const req = create.mock.calls[0][0];
    expect(req).toMatchObject({ model: "claude-opus-5-5", betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "medium" } });
    expect(req.output_config.format.type).toBe("json_schema");
  });
  it("a refusal or a bad shape is a failed check, not a stop; no key or no credits stops the run", async () => {
    create.mockResolvedValueOnce(answer({}, { stop: "refusal" }));
    expect(await judgeJson({ system: "s", content: [], schema: { type: "OBJECT", properties: {} }, parse: (x) => x })).toMatchObject({ ok: false, stop: false });
    create.mockResolvedValueOnce(answer({ wrong: 1 }));
    expect(await judgeJson({ system: "s", content: [], schema: { type: "OBJECT", properties: {} }, parse: () => null })).toMatchObject({ ok: false, stop: false, error: expect.stringMatching(/wrong shape/) });
    delete process.env.ANTHROPIC_API_KEY;
    expect(await judgeJson({ system: "s", content: [], schema: { type: "OBJECT", properties: {} }, parse: (x) => x })).toMatchObject({ ok: false, stop: true });
    expect(isStopError(CLAUDE_CREDITS_OUT)).toBe(true);
    expect(isStopError("Claude rejected the API key (401). Check ANTHROPIC_API_KEY.")).toBe(true);
    expect(isStopError("Claude timed out.")).toBe(false);
  });
});

describe("judgeNames", () => {
  it("sends the post's target and every name; verdicts come back in the input order, a skipped name fails", async () => {
    create.mockResolvedValueOnce(answer({ names: [
      { name: "Sabina", good: true, fits: true, reason: "", meaning: "Woman From Sabine ", appeal: 8 },
      { name: "Sqiggle", good: false, fits: true, reason: "made up", meaning: "", appeal: 1 },
    ] }));
    const r = await judgeNames({ gender: "girl", target: { kind: "letter", letter: "S" }, names: [
      { name: "Sqiggle", meaning: "?" }, { name: "Sabina", meaning: "from sabine" }, { name: "Selah", meaning: "pause" },
    ] });
    expect(r.ok && r.data).toEqual([
      { name: "Sqiggle", good: false, fits: true, reason: "made up", meaning: "", meaning_wrong: false, appeal: 1 },
      { name: "Sabina", good: true, fits: true, reason: "", meaning: "woman from sabine", meaning_wrong: false, appeal: 8 },
      { name: "Selah", good: false, fits: false, reason: "not judged", meaning: "", meaning_wrong: false, appeal: 0 },
    ]);
    const prompt = create.mock.calls[0][0].messages[0].content[0].text as string;
    expect(prompt).toContain("start with the letter S");
    expect(prompt).toContain("- Selah: pause");
  });
  it("asks whether the meaning is wrong (schema and prompt), passes meaning_wrong through, and keeps commas in meanings", async () => {
    create.mockResolvedValueOnce(answer({ names: [
      { name: "Hannah", good: true, fits: true, reason: "", meaning: "Grace, Favor!", meaning_wrong: true, appeal: 9 },
      { name: "Ruth", good: true, fits: true, reason: "", meaning: "friend, companion", meaning_wrong: false, appeal: 7 },
      { name: "Mara", good: false, fits: true, reason: "sad meaning", meaning: "bitter", meaning_wrong: true, appeal: 1 },
    ] }));
    const r = await judgeNames({ gender: "girl", target: { kind: "theme", title: "Biblical", hint: null }, names: [
      { name: "Hannah", meaning: "brave" }, { name: "Ruth", meaning: "friend" }, { name: "Mara", meaning: "bitter" },
    ] });
    expect(r.ok && r.data.map((v) => [v.meaning, v.meaning_wrong])).toEqual([["grace, favor", true], ["friend, companion", false], ["", false]]);
    const req = create.mock.calls[0][0];
    expect(req.system).toContain("meaning_wrong: true only when the meaning we have is wrong, not just worded differently");
    const item = req.output_config.format.schema.properties.names.items;
    expect(item.properties.meaning_wrong).toMatchObject({ type: "boolean" });
    expect(item.required).toContain("meaning_wrong");
  });
  it("a kept name without a meaning does not pass", async () => {
    create.mockResolvedValueOnce(answer({ names: [{ name: "Ruth", good: true, fits: true, reason: "", meaning: "", appeal: 6 }] }));
    const r = await judgeNames({ gender: "girl", target: { kind: "theme", title: "Biblical", hint: null }, names: [{ name: "Ruth", meaning: "friend" }] });
    expect(r.ok && r.data[0]).toMatchObject({ good: false, reason: "no meaning" });
  });
  it("appeal is required and checked: 1 to 10, a whole number; any other verdict is not taken (the name fails as not judged)", async () => {
    create.mockResolvedValueOnce(answer({ names: [
      { name: "Ruth", good: true, fits: true, reason: "", meaning: "friend", meaning_wrong: false, appeal: 9 },
      { name: "Naomi", good: true, fits: true, reason: "", meaning: "pleasant", meaning_wrong: false },
      { name: "Leah", good: true, fits: true, reason: "", meaning: "weary", meaning_wrong: false, appeal: 11 },
      { name: "Eden", good: true, fits: true, reason: "", meaning: "delight", meaning_wrong: false, appeal: 7.5 },
    ] }));
    const r = await judgeNames({ gender: "girl", target: { kind: "theme", title: "Biblical", hint: null }, names: [
      { name: "Ruth", meaning: "friend" }, { name: "Naomi", meaning: "pleasant" }, { name: "Leah", meaning: "weary" }, { name: "Eden", meaning: "delight" },
    ] });
    expect(r.ok && r.data.map((v) => [v.name, v.good, v.appeal, v.reason])).toEqual([
      ["Ruth", true, 9, ""], ["Naomi", false, 0, "not judged"], ["Leah", false, 0, "not judged"], ["Eden", false, 0, "not judged"],
    ]);
    const req = create.mock.calls[0][0];
    expect(req.system).toMatch(/appeal: how much a parent would love to choose this name, from 1 to 10/);
    const item = req.output_config.format.schema.properties.names.items;
    expect(item.properties.appeal).toMatchObject({ type: "integer" });
    expect(item.required).toContain("appeal");
  });
});

describe("photo checks", () => {
  it("the front card: the judge is told its stamped text is the post's title; the look-alike list marks it", async () => {
    create.mockResolvedValueOnce(answer({ pass: true, problems: [], note: "" }));
    await judgeCard({ kind: "cover", name: "'S' Names", meaning: "for baby girl" }, "https://signed/f.jpg");
    const req = create.mock.calls[0][0];
    expect(req.messages[0].content[0].text).toBe(`This is the album's front card: its stamped text is the post's title ("'S' Names / for baby girl"). Check this card.`);
    expect(req.system).toMatch(/the front card \(the album's first picture\) has the post's title/);
    create.mockResolvedValueOnce(answer({ remake: [] }));
    await judgeLookAlike([{ card: { kind: "post", name: "A" }, url: "u1" }, { card: { kind: "cover", name: "'S' Names" }, url: "u2" }]);
    const content = create.mock.calls[1][0].messages[0].content;
    expect(content.map((c: { type: string; text?: string }) => c.text ?? c.type)).toEqual(["Card 1:", "image", "Card 2 (the front card):", "image"]);
    expect(create.mock.calls[1][0].system).toMatch(/front card/);
  });

  it("sends the card image by URL with what is stamped on it", async () => {
    create.mockResolvedValueOnce(answer({ pass: false, problems: ["hands"], note: "six fingers" }));
    const r = await judgeCard({ kind: "post", name: "Sabina" }, "https://signed/c1.jpg");
    expect(r.ok && r.data).toEqual({ pass: false, problems: ["hands"], note: "six fingers" });
    const content = create.mock.calls[0][0].messages[0].content;
    expect(content[0].text).toContain("Sabina");
    expect(content[1]).toEqual({ type: "image", source: { type: "url", url: "https://signed/c1.jpg" } });
  });
  it("parses verdicts strictly: a pass with problems is a fail, unknown problems drop, a fail without problems is 'other'", () => {
    expect(parsePhotoVerdict({ pass: true, problems: ["skin"], note: "" })).toEqual({ pass: false, problems: ["skin"], note: "" });
    expect(parsePhotoVerdict({ pass: false, problems: ["weird"], note: "x" })).toEqual({ pass: false, problems: ["other"], note: "x" });
    expect(parsePhotoVerdict({ pass: true, problems: [], note: "" })).toEqual({ pass: true, problems: [], note: "" });
    expect(parsePhotoVerdict({ problems: [] })).toBeNull();
  });
  it("look-alike: numbered cards, later cards only, at most 3, in range", async () => {
    expect(parseLookAlike({ remake: [1, 3, 3, 9, 4, 5, 6] }, 8)).toEqual([3, 4, 5]);
    create.mockResolvedValueOnce(answer({ remake: [2] }));
    const r = await judgeLookAlike([{ card: { kind: "post", name: "A" }, url: "u1" }, { card: { kind: "post", name: "B" }, url: "u2" }]);
    expect(r.ok && r.data).toEqual([2]);
    const content = create.mock.calls[0][0].messages[0].content;
    expect(content.map((c: { type: string; text?: string }) => c.text ?? c.type)).toEqual(["Card 1:", "image", "Card 2:", "image"]);
  });
});

describe("judgeJson stop and retry paths", () => {
  const run = () => judgeJson({ system: "s", content: [], schema: { type: "OBJECT", properties: {} }, parse: (x) => x });
  it("a 401 stops the run", async () => {
    create.mockRejectedValueOnce(APIError.generate(401, { error: { message: "invalid x-api-key" } }, "401", new Headers()));
    expect(await run()).toMatchObject({ ok: false, stop: true, error: expect.stringMatching(/\(401\)/) });
  });
  it("empty credits stop the run with the credits message", async () => {
    create.mockRejectedValueOnce(APIError.generate(400, { error: { message: "Your credit balance is too low" } }, "400", new Headers()));
    expect(await run()).toMatchObject({ ok: false, stop: true, error: CLAUDE_CREDITS_OUT });
  });
  it("a 404 (a model Claude does not know) stops the run", async () => {
    create.mockRejectedValueOnce(APIError.generate(404, { error: { message: "model: claude-opus-5-5" } }, "404", new Headers()));
    expect(await run()).toMatchObject({ ok: false, stop: true, error: expect.stringMatching(/\(404\)/) });
    expect(isStopError("Claude does not know that model (404): x")).toBe(true);
  });
  it("with the refusal fallback, the usage adds up every attempt (the declined one too)", async () => {
    const msg = answer({}, { input: 900, output: 80 });
    Object.assign(msg.usage, { iterations: [
      { type: "message", input_tokens: 1000, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      { type: "fallback_message", input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
    ] });
    create.mockResolvedValueOnce(msg);
    expect(await run()).toMatchObject({ ok: true, usage: { input: 2000, output: 120 } });
    // Without iterations, the top-level usage is the call's.
    create.mockResolvedValueOnce(answer({}, { input: 700, output: 70 }));
    expect(await run()).toMatchObject({ ok: true, usage: { input: 700, output: 70 } });
  });
  it("a timeout is a failed check, not a stop", async () => {
    create.mockRejectedValueOnce(new APIConnectionTimeoutError());
    expect(await run()).toMatchObject({ ok: false, stop: false, error: "Claude timed out." });
  });
  it("max_tokens is a failed check, not a stop", async () => {
    create.mockResolvedValueOnce(answer({}, { stop: "max_tokens" }));
    expect(await run()).toMatchObject({ ok: false, stop: false });
  });
});

describe("judgeNames robustness and batching", () => {
  it("an empty or junk answer is a failed (retryable) check, not 'not judged' for all", async () => {
    create.mockResolvedValueOnce(answer({ names: [] }));
    const target = { kind: "letter" as const, letter: "S" };
    const names = [{ name: "Sabina", meaning: "x" }];
    expect(await judgeNames({ gender: "girl", target, names })).toMatchObject({ ok: false, stop: false });
    create.mockResolvedValueOnce(answer({ names: [1, "a", null] }));
    expect(await judgeNames({ gender: "girl", target, names })).toMatchObject({ ok: false, stop: false });
  });
  it("61 names make two calls and the usage adds up", async () => {
    const names = Array.from({ length: 61 }, (_, k) => ({ name: `S${k}`, meaning: "m" }));
    const verdicts = (ns: { name: string }[]) => ({ names: ns.map((n) => ({ name: n.name, good: true, fits: true, reason: "", meaning: "fine", appeal: 5 })) });
    create.mockResolvedValueOnce(answer(verdicts(names.slice(0, 60)), { input: 1000, output: 100 }));
    create.mockResolvedValueOnce(answer(verdicts(names.slice(60)), { input: 500, output: 50 }));
    const r = await judgeNames({ gender: "girl", target: { kind: "letter", letter: "S" }, names });
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.ok && r.data.length).toBe(61);
    expect(r.usage).toEqual({ input: 1500, output: 150 });
  });
});