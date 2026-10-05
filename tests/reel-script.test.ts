import { beforeEach, describe, expect, it, vi } from "vitest";
import { KNIT_STYLE, scenePrompt } from "@/lib/reels/prompt";
import { NO_TEXT } from "@/lib/planner/prompt";

const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { reelScriptPrompt, writeReelScript, REEL_SCRIPT_MODEL, REEL_SCRIPT_TIMEOUT_MS, ALREADY_MADE_CAP } = await import("@/lib/ai/reel-script");

beforeEach(() => generateJson.mockReset());

const cast = {
  adult: "the mom doll: a crocheted mother doll with chunky dark-brown yarn hair in a low bun, a mustard cardigan",
  child: "the baby doll: a small crocheted baby doll with soft tufts of brown yarn hair, a rust romper",
};
const scene = (n: number, narration = `Line number ${n} is a short spoken phrase for mama.`) =>
  ({ beat: n === 0 ? "hook" : "build", narration, idea: `The mom doll rocks the baby doll by a window, moment ${n}.` });
const script = (count: number, over: Record<string, unknown> = {}) =>
  ({ title: "The Last Time You Carry Them", stage: "baby", cast, scenes: Array.from({ length: count }, (_, i) => scene(i)), ...over });
const NEGATIVE = /\b(avoid|not a|no (blur|watermark|people))\b/i;

describe("reelScriptPrompt", () => {
  it("carries the topic and the max scenes", () => {
    const { system, prompt } = reelScriptPrompt({ topic: "teething at night", maxScenes: 32, alreadyMade: [] });
    expect(prompt).toContain("teething at night");
    expect(prompt).toContain("32");
    expect(system).toMatch(/FILIPINO MOMS/);
    expect(system).toMatch(/EARLY YEARS/);
  });

  it("a blank topic asks Gemini to choose a fresh early-years topic", () => {
    const { prompt } = reelScriptPrompt({ topic: "  ", maxScenes: 40, alreadyMade: [] });
    expect(prompt).toMatch(/CHOOSE a fresh/);
    expect(prompt).toMatch(/NEWBORN/);
  });

  it("lists every already-made title with its stage, or says none yet", () => {
    const made = [{ title: "The Last Time You Carry Them", stage: "baby" }, { title: "Tiny Socks, Big Love" }];
    const { prompt } = reelScriptPrompt({ maxScenes: 40, alreadyMade: made });
    expect(prompt).toContain("- The Last Time You Carry Them (baby)\n");
    expect(prompt).toContain("- Tiny Socks, Big Love\n");
    expect(prompt).toMatch(/newborn\|baby\|toddler\|preschooler/);
    expect(reelScriptPrompt({ maxScenes: 40, alreadyMade: [] }).prompt).toContain("(none yet");
  });

  it("caps the already-made list at the newest titles", () => {
    const made = Array.from({ length: ALREADY_MADE_CAP + 5 }, (_, i) => ({ title: `Reel title ${i}` }));
    const { prompt } = reelScriptPrompt({ maxScenes: 40, alreadyMade: made });
    expect(prompt).toContain(`- Reel title ${ALREADY_MADE_CAP - 1}\n`);
    expect(prompt).not.toContain(`- Reel title ${ALREADY_MADE_CAP}\n`);
  });

  it("asks for the spoken-word budget and short lines, and keeps idea free of style words", () => {
    const { prompt } = reelScriptPrompt({ maxScenes: 40, alreadyMade: [] });
    expect(prompt).toContain("330-420 words");
    expect(prompt).toMatch(/8-12 words/);
    expect(prompt).toMatch(/14 words/);
    expect(prompt).toMatch(/ACTION and SETTING/);
    expect(prompt).toContain("EXACTLY 30-40 scenes");
    expect(prompt).toMatch(/BEFORE ANSWERING, COUNT/);
    expect(reelScriptPrompt({ maxScenes: 10, alreadyMade: [] }).prompt).toContain("EXACTLY 8-10 scenes");
    expect(prompt).toMatch(/Only the first 1-2 lines are the 'hook' beat/);
    expect(prompt).not.toMatch(/\bcamera\b/i);
  });

  it("a small max shrinks the word budget so lines stay short", () => {
    const { prompt } = reelScriptPrompt({ maxScenes: 10, alreadyMade: [] });
    expect(prompt).toContain("100-120 words");
  });
});

describe("scenePrompt", () => {
  const p = scenePrompt(cast, "The mom doll lifts the baby doll high in a sunny felt garden.", "build", 3);
  it("carries the idea, the cast, the style and the no-text line", () => {
    expect(p).toContain("lifts the baby doll high");
    expect(p).toContain(cast.adult);
    expect(p).toContain(cast.child);
    expect(p).toContain(KNIT_STYLE);
    expect(p).toContain(NO_TEXT);
    expect(p).toMatch(/9:16/);
    expect(p).toMatch(/every setting is built from felt and linen/);
    expect(p).toMatch(/upper third is calm and uncluttered/);
    expect(p).not.toMatch(/caption/i);
  });
  it("gives the hook treatment only to the opening picture", () => {
    expect(scenePrompt(cast, "The mom doll gasps.", "hook", 0)).toMatch(/high-emotion moment/);
    expect(scenePrompt(cast, "The mom doll gasps.", "hook", 1)).not.toMatch(/high-emotion/);
    expect(scenePrompt(cast, "The mom doll gasps.", "hook", 1)).toMatch(/one tender moment/);
  });
  it("is positive-only (apart from NO_TEXT) and never says camera", () => {
    for (const beat of ["hook", "build", "turn", "close", "other"]) {
      const q = scenePrompt(cast, "The dad doll reads to the toddler doll on a felt sofa.", beat, beat === "hook" ? 0 : 2);
      expect(q).not.toMatch(/\bcamera\b/i);
      expect(q.replace(NO_TEXT, "")).not.toMatch(NEGATIVE);
    }
    expect(KNIT_STYLE).not.toMatch(NEGATIVE);
  });
});

describe("writeReelScript", () => {
  const input = { maxScenes: 40, alreadyMade: [] };
  const input10 = { maxScenes: 10, alreadyMade: [] };

  it("uses the script model with the ported prompt and returns a typed script", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(30) });
    const r = await writeReelScript(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.script.title).toBe("The Last Time You Carry Them");
      expect(r.script.stage).toBe("baby");
      expect(r.script.cast).toEqual(cast);
      expect(r.script.scenes).toHaveLength(30);
      expect(r.script.scenes[0]).toEqual(scene(0));
    }
    const arg = generateJson.mock.calls[0][0];
    expect(arg.model).toBe(REEL_SCRIPT_MODEL);
    expect(arg.prompt).toContain("40");
    expect(arg.timeoutMs).toBe(REEL_SCRIPT_TIMEOUT_MS);
    expect(REEL_SCRIPT_TIMEOUT_MS).toBe(120_000);
  });

  it("uses the caller's remaining time budget when given", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(10) });
    await writeReelScript({ ...input10, timeoutMs: 70_000 });
    expect(generateJson.mock.calls[0][0].timeoutMs).toBe(70_000);
  });

  it("rejects a missing or unknown stage", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(10, { stage: "teen" }) });
    expect(await writeReelScript(input10)).toMatchObject({ ok: false });
    generateJson.mockResolvedValueOnce({ ok: true, data: script(10, { stage: undefined }) });
    expect(await writeReelScript(input10)).toMatchObject({ ok: false });
  });

  it("trims scenes beyond the max", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(45) });
    const r = await writeReelScript(input);
    expect(r.ok && r.script.scenes.length).toBe(40);
  });

  it("rejects a script under 75% of the max scenes", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(29) });
    expect(await writeReelScript(input)).toEqual({ ok: false, error: "Script too short: 29 scenes (needs at least 30)." });
    generateJson.mockResolvedValueOnce({ ok: true, data: script(8) });
    expect(await writeReelScript(input10)).toMatchObject({ ok: true });
  });

  it("rejects a script under 80% of the word-budget minimum", async () => {
    const s = script(32);
    s.scenes = s.scenes.map((x, i) => (i === 0 ? x : { ...x, narration: "You hold them close, mama." }));
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    expect(await writeReelScript(input)).toEqual({ ok: false, error: "Script too short: 165 words (needs at least 264)." });
  });

  it("rejects too few scenes", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(1) });
    expect(await writeReelScript(input10)).toMatchObject({ ok: false });
  });

  it("rejects an empty narration line", async () => {
    const s = script(10);
    s.scenes[3] = scene(3, "   ");
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    expect(await writeReelScript(input10)).toMatchObject({ ok: false, error: expect.stringMatching(/line 4/i) });
  });

  it("rejects a line longer than 14 words", async () => {
    const s = script(10);
    s.scenes[2] = scene(2, "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen");
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    expect(await writeReelScript(input10)).toMatchObject({ ok: false });
  });

  it("rejects a missing cast member, a missing title or a too-long title", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(10, { cast: { adult: cast.adult, child: " " } }) });
    expect(await writeReelScript(input10)).toMatchObject({ ok: false });
    generateJson.mockResolvedValueOnce({ ok: true, data: script(10, { cast: undefined }) });
    expect(await writeReelScript(input10)).toMatchObject({ ok: false });
    generateJson.mockResolvedValueOnce({ ok: true, data: script(10, { title: "" }) });
    expect(await writeReelScript(input10)).toMatchObject({ ok: false });
    generateJson.mockResolvedValueOnce({ ok: true, data: script(10, { title: "x".repeat(81) }) });
    expect(await writeReelScript(input10)).toMatchObject({ ok: false });
  });

  it("passes a Gemini failure through and never throws", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini timed out." });
    expect(await writeReelScript(input)).toEqual({ ok: false, error: "Gemini timed out." });
    generateJson.mockRejectedValueOnce(new Error("boom"));
    expect(await writeReelScript(input10)).toMatchObject({ ok: false });
  });

  it("turns 'at/into/toward the camera' into 'toward the viewer' in ideas and cast", async () => {
    const s = script(10, { cast: { adult: `${cast.adult}, smiling into the camera`, child: cast.child } });
    s.scenes[1] = { beat: "build", narration: "You hold them close.", idea: "The mom doll smiles at the camera." };
    s.scenes[2] = { beat: "build", narration: "You hold them close.", idea: "The baby doll crawls toward a camera." };
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r = await writeReelScript(input10);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.script.scenes[1].idea).toBe("The mom doll smiles toward the viewer.");
      expect(r.script.scenes[2].idea).toBe("The baby doll crawls toward the viewer.");
      expect(r.script.cast.adult).toMatch(/smiling toward the viewer$/);
    }
  });
});
