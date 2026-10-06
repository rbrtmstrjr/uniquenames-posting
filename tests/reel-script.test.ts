import { beforeEach, describe, expect, it, vi } from "vitest";
import { KNIT_STYLE, scenePrompt } from "@/lib/reels/prompt";
import { STATIC_THEMES } from "@/lib/reels/themes";
import { NO_TEXT } from "@/lib/planner/prompt";

const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { reelScriptPrompt, writeReelScript, REEL_SCRIPT_MODEL, REEL_SCRIPT_TIMEOUT_MS, ALREADY_MADE_CAP } = await import("@/lib/ai/reel-script");

beforeEach(() => generateJson.mockReset());

const cast = {
  adult: "the mom doll: a crocheted mother doll with chunky dark-brown yarn hair in a low bun, a mustard cardigan",
  child: "the baby doll: a small crocheted baby doll with soft tufts of brown yarn hair, a rust romper",
};
const HOOK = "Stop rushing the last time you carry them.";
const scene = (n: number, narration = n === 0 ? HOOK : `Line number ${n} is a short spoken phrase for mama.`) =>
  ({ beat: n === 0 ? "hook" : "build", narration, idea: `The mom doll rocks the baby doll by a window, moment ${n}.`,
    emotion: "tender", action: "rocks gently, both arms wrapped around the baby doll", shot: n % 2 ? "wide" : "medium", key: false });
const KNIT = STATIC_THEMES.knitted;
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
  const p = scenePrompt(KNIT, cast, { idea: "The mom doll sits with the baby doll in a sunny felt garden.", beat: "build" }, 3);
  it("carries the idea, the cast, the style and the no-text line", () => {
    expect(p).toContain("sits with the baby doll");
    expect(p).toContain(cast.adult);
    expect(p).toContain(cast.child);
    expect(p).toContain(KNIT_STYLE);
    expect(p).toContain(NO_TEXT);
    expect(p).toMatch(/9:16/);
    expect(p).toMatch(/every setting is built from felt and linen/);
    expect(p).toMatch(/band just below the middle is calm and uncluttered/);
    expect(p).not.toMatch(/upper third/);
    expect(p).not.toMatch(/caption/i);
  });
  it("gives the hook treatment only to the opening picture", () => {
    expect(scenePrompt(KNIT, cast, { idea: "The mom doll gasps.", beat: "hook" }, 0)).toMatch(/high-emotion moment/);
    expect(scenePrompt(KNIT, cast, { idea: "The mom doll gasps.", beat: "hook" }, 1)).not.toMatch(/high-emotion/);
    expect(scenePrompt(KNIT, cast, { idea: "The mom doll gasps.", beat: "hook" }, 1)).toMatch(/one tender moment/);
  });
  it("is positive-only (apart from NO_TEXT) and never says camera", () => {
    for (const beat of ["hook", "build", "turn", "close", "other"]) {
      const q = scenePrompt(KNIT, cast, { idea: "The dad doll reads to the toddler doll on a felt sofa.", beat }, beat === "hook" ? 0 : 2);
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
    const eight = script(8);
    eight.scenes[1] = scene(1, "Line number 1 is a slightly longer spoken phrase for you mama.");   // 8 + 12 + 6 × 10 = 80 words
    generateJson.mockResolvedValueOnce({ ok: true, data: eight });
    expect(await writeReelScript(input10)).toMatchObject({ ok: true });
  });

  it("rejects a script under 80% of the word-budget minimum", async () => {
    const s = script(32);
    s.scenes = s.scenes.map((x, i) => (i === 0 ? x : { ...x, narration: "You hold them close, mama." }));
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    expect(await writeReelScript(input)).toEqual({ ok: false, error: "Script too short: 163 words (needs at least 264)." });
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
    s.scenes[1] = { ...scene(1), narration: "You hold them close.", idea: "The mom doll smiles at the camera." };
    s.scenes[2] = { ...scene(2), narration: "You hold them close.", idea: "The baby doll crawls toward a camera." };
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

describe("narration speed scales the word target", () => {
  it("1× keeps the old budget; 1.12× asks for more words in the same 90-120 s", async () => {
    const { reelWordBudget } = await import("@/lib/ai/reel-script");
    expect(reelWordBudget(40)).toMatchObject({ lo: 330, hi: 420, secLo: 94, secHi: 120 });
    const fast = reelWordBudget(40, 1.12);
    expect(fast).toMatchObject({ lo: 370, hi: 470, minWords: 296, wpsLo: 3.9, wpsHi: 4.5 });
    expect(fast.secLo).toBe(94);
    expect(fast.secHi).toBe(120);
    // few images: lines stay at most 10-12 words each, whatever the speed
    expect(reelWordBudget(10, 1.25)).toMatchObject({ lo: 100, hi: 120 });
  });

  it("the prompt and the validation use the speed", async () => {
    const { prompt } = reelScriptPrompt({ maxScenes: 40, alreadyMade: [], speed: 1.12 });
    expect(prompt).toContain("370-470 words");
    expect(prompt).toContain("about 3.9-4.5 words per second");
    // an 8-word hook + 29 lines of 10 words = 298: enough at 1× (264) and at 1.12× (296)
    generateJson.mockResolvedValueOnce({ ok: true, data: script(30) });
    expect((await writeReelScript({ maxScenes: 40, alreadyMade: [], speed: 1.12 })).ok).toBe(true);
    // 1.25×: lo = min(413, 40 × 10) = 400, needs 320
    generateJson.mockResolvedValueOnce({ ok: true, data: script(30) });
    expect(await writeReelScript({ maxScenes: 40, alreadyMade: [], speed: 1.25 })).toEqual({ ok: false, error: "Script too short: 298 words (needs at least 320)." });
  });
});

describe("ad-style script: emotion, action, shot, key + hook / mini-hook / loop (007)", () => {
  const input10 = { maxScenes: 10, alreadyMade: [] };

  it("the prompt asks for a scroll-stopper line 1 (never a greeting), mini-hooks every 4-6 lines and a loop back", () => {
    const { prompt } = reelScriptPrompt(input10);
    expect(prompt).toMatch(/LINE 1 IS A SCROLL-STOPPER spoken in under 2 seconds: at most 7 words/);
    expect(prompt).toMatch(/bold claim/);
    expect(prompt).toMatch(/'stop doing X'/);
    expect(prompt).toMatch(/open question/);
    expect(prompt).toMatch(/NEVER a greeting/);
    expect(prompt).toMatch(/Every 4-6 lines, drop a MINI-HOOK/);
    expect(prompt).toMatch(/LAST line LOOPS BACK to the opening/);
    expect(prompt).not.toMatch(/\bcamera\b/i);
  });

  it("the prompt lists the fixed emotions and shots, no repeated shots, at most 3 key lines", async () => {
    const { REEL_EMOTIONS, REEL_SHOTS } = await import("@/lib/reels/motion");
    const { prompt } = reelScriptPrompt(input10);
    expect(prompt).toContain(`exactly one of ${REEL_EMOTIONS.join("|")}`);
    expect(prompt).toContain(`exactly one of ${REEL_SHOTS.join("|")}`);
    expect(prompt).toMatch(/NEVER the same shot on two lines in a row/);
    expect(prompt).toMatch(/AT MOST 3 lines/);
    expect(prompt).toMatch(/"action".*never mention what is absent/);
    expect(REEL_EMOTIONS.length).toBe(12);
    expect(REEL_SHOTS.length).toBe(6);
  });

  it("knitted (default): doll cast, emotion through pose only, and never a lift", () => {
    const { prompt } = reelScriptPrompt(input10);
    expect(prompt).toMatch(/describe the recurring cast AS TEXTILE DOLLS/);
    expect(prompt).toMatch(/EVERY emotion must show through POSE and HANDS/);
    expect(prompt).toMatch(/sitting, standing, kneeling, lying or cuddling together/);
    expect(prompt).toMatch(/Never have a doll lift, raise, toss or hold the child doll up/);
  });

  it("other themes: a people cast; faces themes read the emotion on faces, papercraft through pose", () => {
    const a = reelScriptPrompt({ ...input10, theme: { id: "animated3d", faces: true } }).prompt;
    expect(a).toMatch(/describe the recurring cast as REAL PEOPLE/);
    expect(a).not.toMatch(/TEXTILE DOLLS|the mom doll/);
    expect(a).toMatch(/emotion should be readable on both faces/);
    expect(a).not.toMatch(/lift, raise/);
    const p = reelScriptPrompt({ ...input10, theme: { id: "papercraft", faces: false } }).prompt;
    expect(p).toMatch(/REAL PEOPLE/);
    expect(p).toMatch(/simple fixed faces, so EVERY emotion must show through POSE/);
  });

  it("the schema requires emotion (enum), action, shot (enum) and key (boolean)", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(10) });
    await writeReelScript(input10);
    const items = generateJson.mock.calls[0][0].schema.properties.scenes.items;
    expect(items.required).toEqual(["beat", "narration", "idea", "emotion", "action", "shot", "key"]);
    expect(items.properties.emotion.enum).toHaveLength(12);
    expect(items.properties.shot.enum).toHaveLength(6);
    expect(items.properties.key.type).toBe("BOOLEAN");
  });

  it("keeps each line's emotion, action, shot and key", async () => {
    const s = script(10);
    s.scenes[4] = { ...scene(4), emotion: "teary", action: "hugs the baby doll close at the camera", shot: "over-the-shoulder", key: true };
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r = await writeReelScript(input10);
    expect(r.ok && r.script.scenes[4]).toEqual({ ...scene(4), emotion: "teary", action: "hugs the baby doll close toward the viewer", shot: "over-the-shoulder", key: true });
  });

  it("line 1 longer than 9 words is rejected (a hook is under 2 s)", async () => {
    const s = script(10);
    s.scenes[0] = scene(0, "One day you will carry them for the very last time.");
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    expect(await writeReelScript(input10)).toEqual({ ok: false, error: "Line 1 is too long for a hook (11 words; at most 9)." });
    s.scenes[0] = scene(0, "One day you'll carry them for the last time.");   // 9 words: fine
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    expect((await writeReelScript(input10)).ok).toBe(true);
  });

  it("line 1 that greets is rejected", async () => {
    for (const hello of ["Hey mama, stop rushing bedtime tonight.", "Hello there, tired mama.", "Good morning, mama!", "Welcome back to the page."]) {
      const s = script(10);
      s.scenes[0] = scene(0, hello);
      generateJson.mockResolvedValueOnce({ ok: true, data: s });
      expect(await writeReelScript(input10), hello).toEqual({ ok: false, error: "Line 1 is a greeting, not a hook." });
    }
    const s = script(10);
    s.scenes[0] = scene(0, "Why do babies fight sleep so hard?");
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    expect((await writeReelScript(input10)).ok).toBe(true);
  });

  it("an unknown emotion becomes tender; a missing action becomes ''; long actions are cut", async () => {
    const s = script(10);
    s.scenes[2] = { ...scene(2), emotion: "melancholic", action: undefined as unknown as string };
    s.scenes[3] = { ...scene(3), emotion: " Proud ", action: "x".repeat(300) };
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r = await writeReelScript(input10);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.script.scenes[2]).toMatchObject({ emotion: "tender", action: "" });
      expect(r.script.scenes[3].emotion).toBe("proud");
      expect(r.script.scenes[3].action).toHaveLength(200);
    }
  });

  it("never the same shot on two lines in a row; unknown shots are filled", async () => {
    const s = script(10);
    const shots = ["medium", "medium", "Over the shoulder", "nope", "wide", "wide", "wide", "eye-level", "eye_level", "low-angle"];
    s.scenes = s.scenes.map((x, i) => ({ ...x, shot: shots[i] }));
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r = await writeReelScript(input10);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const got = r.script.scenes.map((x) => x.shot);
      for (let i = 1; i < got.length; i++) expect(got[i], `line ${i + 1}`).not.toBe(got[i - 1]);
      expect(got[0]).toBe("medium");
      expect(got[2]).toBe("over-the-shoulder");
      expect(got[4]).toBe("wide");
      expect(got[7]).toBe("eye-level");
      expect(got[9]).toBe("low-angle");
    }
  });

  it("at most 3 key lines (the first ones marked)", async () => {
    const s = script(10);
    s.scenes = s.scenes.map((x, i) => ({ ...x, key: i % 2 === 1 }));
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r = await writeReelScript(input10);
    expect(r.ok && r.script.scenes.map((x) => x.key)).toEqual([false, true, false, true, false, true, false, false, false, false]);
    // line 1 never counts as key (it punches anyway), so it does not use up a slot
    s.scenes = s.scenes.map((x, i) => ({ ...x, key: i < 5 }));
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r2 = await writeReelScript(input10);
    expect(r2.ok && r2.script.scenes.map((x) => x.key).slice(0, 5)).toEqual([false, true, true, true, false]);
    // a key mark on a hook line (line 2 with the hook beat) is dropped and does not use up a slot either
    s.scenes = s.scenes.map((x, i) => ({ ...x, beat: i < 2 ? "hook" : "build", key: i < 6 }));
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r3 = await writeReelScript(input10);
    expect(r3.ok && r3.script.scenes.map((x) => x.key).slice(0, 6)).toEqual([false, false, true, true, true, false]);
  });
});
