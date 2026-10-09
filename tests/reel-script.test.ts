import { beforeEach, describe, expect, it, vi } from "vitest";
import { shotListIssues } from "@/lib/reels/shots";
import { splitIdea } from "@/lib/reels/prompt";

const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const {
  reelScriptPrompt, writeReelScript, reelWordBudget, REEL_SCRIPT_MODEL, REEL_SCRIPT_TIMEOUT_MS, ALREADY_MADE_CAP, LINE_MAX_WORDS,
} = await import("@/lib/ai/reel-script");

beforeEach(() => generateJson.mockReset());

const cast = {
  adult: "the mom doll: a crocheted mother doll with chunky dark-brown yarn hair in a low bun, a mustard cardigan",
  child: "the baby doll: a small crocheted baby doll with soft tufts of brown yarn hair, a rust romper",
  adult_tag: "mom doll, tan wool skin, yarn bun, mustard cardigan",
  child_tag: "baby doll, tan wool skin, rust romper",
};
const HOOK = "You'll carry them for the very last time.";
const HOOK_TEXT = "And you won't know it's the last";
// a shot list that already follows every rule (10 lines)
const SHOTS = [
  ["close", "both"], ["wide", "both"], ["detail", "object"], ["medium", "mom"], ["close", "baby"],
  ["detail", "mom"], ["medium", "both"], ["broll", "none"], ["medium", "baby"], ["close", "both"],
] as const;
const scene = (n: number, narration = n === 0 ? HOOK : `Line number ${n} is a short spoken phrase for mama.`) => ({
  beat: n === 0 ? "hook" : "build", narration, idea: `The mom doll rocks the baby doll, moment ${n}.`, setting: n === 0 ? "the nursery at 3 a.m." : `the sala, moment ${n}`,
  emotion: "tender", action: "rocks gently, both arms wrapped around the baby doll",
  shot_size: SHOTS[n % 10][0], subject: SHOTS[n % 10][1], punch: "", time_jump: false,
});
const script = (count: number, over: Record<string, unknown> = {}) =>
  ({ title: "The Last Time You Carry Them", stage: "baby", hook_text: HOOK_TEXT, cast, scenes: Array.from({ length: count }, (_, i) => scene(i)), ...over });
// the playbook tests below run on an old theme (Knitted Doll); the guide styles have their own block at the end
const KNITTED = { id: "knitted", faces: false } as const;
const input10 = { maxScenes: 10, alreadyMade: [], theme: KNITTED };
const input30 = { maxScenes: 30, alreadyMade: [], theme: KNITTED };

describe("reelScriptPrompt", () => {
  it("carries the topic and the max scenes", () => {
    const { system, prompt } = reelScriptPrompt({ topic: "teething at night", maxScenes: 32, alreadyMade: [] });
    expect(prompt).toContain("teething at night");
    expect(prompt).toContain("-32 lines");
    expect(system).toMatch(/Filipino moms/);
    expect(system).toMatch(/early years/);
  });

  it("a blank topic asks Gemini to choose a fresh early-years topic", () => {
    const { prompt } = reelScriptPrompt({ topic: "  ", maxScenes: 40, alreadyMade: [] });
    expect(prompt).toMatch(/CHOOSE one fresh/);
    expect(prompt).toMatch(/NEWBORN/);
  });

  it("lists every already-made title with its stage, or says none yet; capped at the newest", () => {
    const made = [{ title: "The Last Time You Carry Them", stage: "baby" }, { title: "Tiny Socks, Big Love" }];
    const { prompt } = reelScriptPrompt({ maxScenes: 40, alreadyMade: made });
    expect(prompt).toContain("- The Last Time You Carry Them (baby)\n");
    expect(prompt).toContain("- Tiny Socks, Big Love\n");
    expect(prompt).toMatch(/newborn\|baby\|toddler\|preschooler/);
    expect(reelScriptPrompt({ maxScenes: 40, alreadyMade: [] }).prompt).toContain("(none yet");
    const many = Array.from({ length: ALREADY_MADE_CAP + 5 }, (_, i) => ({ title: `Reel title ${i}` }));
    const p = reelScriptPrompt({ maxScenes: 40, alreadyMade: many }).prompt;
    expect(p).toContain(`- Reel title ${ALREADY_MADE_CAP - 1}\n`);
    expect(p).not.toContain(`- Reel title ${ALREADY_MADE_CAP}\n`);
  });

  it("the 45-75 s length: word budget, line count, short lines, never 'camera'", () => {
    const { prompt } = reelScriptPrompt(input30);
    expect(prompt).toContain("narration for a 45-75 second reel at about 3.8 words per second = 171-285 words");
    expect(prompt).toContain("18-30 lines");
    expect(prompt).toMatch(/Sentences of 4-12 words \(never more than 15\)/);
    expect(prompt).toMatch(/BEFORE ANSWERING, COUNT/);
    expect(prompt).not.toMatch(/\bcamera\b/i);
  });

  it("playbook script rules: hook, banned openers, stakes, re-hooks, identity line, turn at 70-80 %, loop, no CTA", () => {
    const { prompt } = reelScriptPrompt(input10);
    expect(prompt).toMatch(/LINE 1 is the hook, spoken in the first half-second: at most 12 words/);
    expect(prompt).toMatch(/TENSION, a TIME-JUMP, 'you', or a SPECIFIC SURPRISING DETAIL/);
    expect(prompt).toMatch(/BANNED openers: .*'Welcome back'.*'Today I want to talk about'.*'In this video'.*'Let me tell you'.*backstory first/);
    expect(prompt).toMatch(/STAKES within the first ~5 seconds/);
    expect(prompt).toMatch(/RE-HOOK every 10-15 seconds/);
    expect(prompt).toMatch(/identity line/);
    expect(prompt).toMatch(/EMOTIONAL TURN lands at 70-80%/);
    expect(prompt).toMatch(/never pure sadness/);
    expect(prompt).toMatch(/LAST line is the payoff in at most 10 words and loops back to line 1/);
    expect(prompt).toMatch(/NEVER ask viewers to follow, like, comment, tag, share or save/);
    expect(prompt).not.toMatch(/follow the page for more/);
    expect(prompt).toMatch(/"hook_text".*at most 10 words, it COMPLEMENTS line 1/);
    // examples are patterns: Gemini copied them word for word in a smoke run
    expect(prompt).toMatch(/PATTERNS only: write fresh words for THIS story and never reuse an example sentence/);
    expect(prompt).toMatch(/Fresh words for this story, never an example sentence/);
    expect(prompt).toMatch(/hook_text.*ideally at most 8 words and 45 characters/);
  });

  it("asks for a varied shot list: sizes, subjects, the mix, adjacency, line 1 face, establishing wide, mirrored end", async () => {
    const { REEL_SHOT_SIZES, REEL_SUBJECTS } = await import("@/lib/reels/shots");
    const { prompt } = reelScriptPrompt(input10);
    expect(prompt).toContain(`exactly one of ${REEL_SHOT_SIZES.join("|")}`);
    expect(prompt).toContain(`exactly one of ${REEL_SUBJECTS.join("|")}`);
    expect(prompt).toMatch(/about 2 wide, 3 medium, 2 close, 2 detail .* and 1 pov .* or broll/);
    expect(prompt).toMatch(/'both' on at most 4 lines in 10/);
    expect(prompt).toMatch(/LINE 1 shows a FACE .* close or medium/);
    expect(prompt).toMatch(/Line 2 or 3 is the establishing WIDE/);
    expect(prompt).toMatch(/Never the same shot_size with the same subject on two lines in a row; never more than 2 face shots in a row/);
    expect(prompt).toMatch(/LAST line mirrors line 1/);
    expect(prompt).toMatch(/"punch".*at most 3 words, copied EXACTLY.*at most 4 lines/);
    expect(prompt).toMatch(/"time_jump": true only/);
    expect(prompt).toMatch(/"setting": the place \+ time of day/);
  });

  it("knitted: doll cast, emotion through pose only, never a lift; other themes a people cast", () => {
    const k = reelScriptPrompt(input10).prompt;
    expect(k).toMatch(/describe the recurring cast AS TEXTILE DOLLS/);
    expect(k).toMatch(/EVERY emotion must show through POSE and HANDS/);
    expect(k).toMatch(/Never have a doll lift, raise, toss or hold the child doll up/);
    expect(k).toMatch(/"adult_tag" \/ "child_tag": the SAME doll in at most 7 words/);
    const a = reelScriptPrompt({ ...input10, theme: { id: "animated3d", faces: true } }).prompt;
    expect(a).toMatch(/describe the recurring cast as REAL PEOPLE/);
    expect(a).not.toMatch(/TEXTILE DOLLS|the mom doll/);
    expect(a).toMatch(/emotion should be readable on the faces/);
    expect(a).toMatch(/PEOPLE, NOT DOLLS: .*never doll, yarn, crochet, knitted, felt or wool wording/);
    expect(k).not.toMatch(/PEOPLE, NOT DOLLS/);
    const p = reelScriptPrompt({ ...input10, theme: { id: "papercraft", faces: false } }).prompt;
    expect(p).toMatch(/simple fixed faces, so EVERY emotion must show through POSE/);
  });
});

describe("reelWordBudget (45-75 s at 3.8 words/s × speed)", () => {
  it("1×: 171-285 words; few images shrink it, never under 18 s of speech", () => {
    expect(reelWordBudget(30)).toEqual({ lo: 171, hi: 285, minScenes: 18, minWords: 137, secLo: 45, secHi: 75, wps: 3.8 });
    expect(reelWordBudget(40)).toMatchObject({ lo: 171, hi: 285, minScenes: 18 });
    expect(reelWordBudget(10)).toMatchObject({ lo: 70, hi: 100, minScenes: 7, minWords: 57 });
    const fast = reelWordBudget(10, 1.25);
    expect(fast.lo).toBe(86);   // 18 s at 4.75 words/s
    expect(fast.minWords / (3.8 * 1.25)).toBeGreaterThanOrEqual(15);
    expect(reelWordBudget(30, 1.12)).toMatchObject({ lo: 192, hi: 300, secLo: 45, secHi: 70, wps: 4.3 });   // hi capped at 10 words a line
  });
});

describe("writeReelScript", () => {
  it("uses the script model and returns a typed script with the hook card, tags and the v2 per-line fields", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(20) });
    const r = await writeReelScript(input30);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.script).toMatchObject({ title: "The Last Time You Carry Them", stage: "baby", hook_text: HOOK_TEXT, cast: { ...cast, child_age: "a baby" } });
    expect(r.script.scenes).toHaveLength(20);
    expect(r.script.scenes[0]).toEqual({
      beat: "hook", narration: HOOK, idea: "The mom doll rocks the baby doll, moment 0 — the nursery at 3 a.m", emotion: "tender",
      action: "rocks gently, both arms wrapped around the baby doll", shot_size: "close", subject: "both", punch: null, time_jump: false,
    });
    const arg = generateJson.mock.calls[0][0];
    expect(arg.model).toBe(REEL_SCRIPT_MODEL);
    expect(arg.timeoutMs).toBe(REEL_SCRIPT_TIMEOUT_MS);
    const items = arg.schema.properties.scenes.items;
    expect(items.required).toEqual(["beat", "narration", "idea", "setting", "shot_size", "subject", "emotion", "action", "punch", "time_jump"]);
    expect(items.properties.shot_size.enum).toHaveLength(6);
    expect(items.properties.subject.enum).toHaveLength(5);
    expect(items.properties.time_jump.type).toBe("BOOLEAN");
    expect(arg.schema.required).toContain("hook_text");
    expect(arg.schema.properties.cast.required).toEqual(["adult", "child", "adult_tag", "child_tag", "child_age"]);
  });

  it("uses the caller's remaining time budget when given", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(10) });
    await writeReelScript({ ...input10, timeoutMs: 70_000 });
    expect(generateJson.mock.calls[0][0].timeoutMs).toBe(70_000);
  });

  it("rejects a missing / unknown stage, a missing cast member, a missing or too-long title", async () => {
    for (const over of [{ stage: "teen" }, { stage: undefined }, { cast: { adult: cast.adult, child: " " } }, { cast: undefined }, { title: "" }, { title: "x".repeat(81) }]) {
      generateJson.mockResolvedValueOnce({ ok: true, data: script(10, over) });
      expect(await writeReelScript(input10), JSON.stringify(over)).toMatchObject({ ok: false });
    }
  });

  it("missing short tags are fine (the prompt builder cuts one from the description)", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(10, { cast: { adult: cast.adult, child: cast.child } }) });
    const r = await writeReelScript(input10);
    expect(r.ok && r.script.cast).toEqual({ adult: cast.adult, child: cast.child, child_age: "a baby" });
    // Gemini's own age wins
    generateJson.mockResolvedValueOnce({ ok: true, data: script(10, { cast: { ...cast, child_age: "a 10-month-old baby boy" } }) });
    const r2 = await writeReelScript(input10);
    expect(r2.ok && r2.script.cast.child_age).toBe("a 10-month-old baby boy");
  });

  it("trims scenes beyond the max; rejects too few scenes or words", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(35) });
    const r = await writeReelScript(input30);
    expect(r.ok && r.script.scenes.length).toBe(30);
    generateJson.mockResolvedValueOnce({ ok: true, data: script(17) });
    expect(await writeReelScript(input30)).toEqual({ ok: false, error: "Script too short: 17 scenes (needs at least 18)." });
    const s = script(20);
    s.scenes = s.scenes.map((x, i) => (i === 0 ? x : { ...x, narration: "You hold them close." }));
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    expect(await writeReelScript(input30)).toEqual({ ok: false, error: "Script too short: 84 words (needs at least 137)." });
    generateJson.mockResolvedValueOnce({ ok: true, data: script(1) });
    expect(await writeReelScript(input10)).toMatchObject({ ok: false });
  });

  it("rejects an empty line, a line over 15 words, an empty idea", async () => {
    const bad = (i: number, patch: Record<string, unknown>) => { const s = script(10); s.scenes[i] = { ...s.scenes[i], ...patch }; return s; };
    generateJson.mockResolvedValueOnce({ ok: true, data: bad(3, { narration: "   " }) });
    expect(await writeReelScript(input10)).toMatchObject({ ok: false, error: expect.stringMatching(/line 4/i) });
    const sixteen = Array.from({ length: LINE_MAX_WORDS + 1 }, (_, i) => `w${i}`).join(" ");
    generateJson.mockResolvedValueOnce({ ok: true, data: bad(2, { narration: sixteen }) });
    expect(await writeReelScript(input10)).toEqual({ ok: false, error: "Line 3 is longer than 15 words." });
    generateJson.mockResolvedValueOnce({ ok: true, data: bad(2, { idea: " " }) });
    expect(await writeReelScript(input10)).toEqual({ ok: false, error: "Line 3 has no image idea." });
  });

  it("line 1: at most 12 words, never a banned opener", async () => {
    const first = (narration: string) => { const s = script(10); s.scenes[0] = scene(0, narration); return s; };
    generateJson.mockResolvedValueOnce({ ok: true, data: first("One day you will carry them in your arms for the very last time.") });
    expect(await writeReelScript(input10)).toEqual({ ok: false, error: "Line 1 is too long for a hook (14 words; at most 12)." });
    for (const opener of ["Hey mga mommies, listen up.", "Hello there, tired mama.", "Welcome back to the page, mama.", "Today I want to talk about sleep.",
      "In this video, three sleep tips.", "Let me tell you about my son.", "Unique Names here with a story."]) {
      generateJson.mockResolvedValueOnce({ ok: true, data: first(opener) });
      expect(await writeReelScript(input10), opener).toEqual({ ok: false, error: "Line 1 is a greeting, not a hook." });
    }
    generateJson.mockResolvedValueOnce({ ok: true, data: first("Why does 3 a.m. feel this long, mama?") });
    expect((await writeReelScript(input10)).ok).toBe(true);
  });

  it("no spoken call to action on any line", async () => {
    for (const cta of ["Follow the page for more stories like this.", "Comment below if this is you, mama.", "Tag a mom who needs this today.",
      "Share this with a tired mom tonight.", "Save this for the hard nights ahead."]) {
      const s = script(10);
      s.scenes[9] = scene(9, cta);
      generateJson.mockResolvedValueOnce({ ok: true, data: s });
      expect(await writeReelScript(input10), cta).toEqual({ ok: false, error: "Line 10 asks viewers to follow, comment, tag or share." });
    }
    const ok = script(10);
    ok.scenes[5] = scene(5, "You share your last spoonful of rice with her.");
    generateJson.mockResolvedValueOnce({ ok: true, data: ok });
    expect((await writeReelScript(input10)).ok).toBe(true);
  });

  it("the hook card: required, at most 10 words, never a greeting, never line 1 again", async () => {
    const cases: [unknown, string][] = [
      ["", "The script has no hook card."],
      ["one two three four five six seven eight nine ten eleven", "The hook card is longer than 10 words."],
      ["Hey mama, watch this", "The hook card is a greeting or a call to action, not a hook."],
      ["you'll carry them for the very last time", "The hook card repeats line 1 instead of adding to it."],
    ];
    for (const [hook_text, error] of cases) {
      generateJson.mockResolvedValueOnce({ ok: true, data: script(10, { hook_text }) });
      expect(await writeReelScript(input10), String(hook_text)).toEqual({ ok: false, error });
    }
  });

  it("passes a Gemini failure through and never throws", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini timed out." });
    expect(await writeReelScript(input10)).toEqual({ ok: false, error: "Gemini timed out." });
    generateJson.mockRejectedValueOnce(new Error("boom"));
    expect(await writeReelScript(input10)).toMatchObject({ ok: false });
  });

  it("turns 'at/into/toward the camera' into 'toward the viewer' in ideas and cast", async () => {
    const s = script(10, { cast: { ...cast, adult: `${cast.adult}, smiling into the camera` } });
    s.scenes[1] = { ...scene(1), idea: "The mom doll smiles at the camera." };
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r = await writeReelScript(input10);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(splitIdea(r.script.scenes[1].idea).moment).toBe("The mom doll smiles toward the viewer");
      expect(r.script.cast.adult).toMatch(/smiling toward the viewer$/);
    }
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
});

describe("the shot list, punches, time jumps and the loop (playbook v2)", () => {
  it("Gemini's drift (every line a medium of mom + baby) is repaired into a list that follows every rule", async () => {
    const s = script(20);
    s.scenes = s.scenes.map((x) => ({ ...x, shot_size: "medium", subject: "both" }));
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r = await writeReelScript(input30);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const shots = r.script.scenes.map((x) => ({ shot_size: x.shot_size, subject: x.subject }));
    expect(shotListIssues(shots, r.script.scenes.map((x) => splitIdea(x.idea).setting))).toEqual([]);
    expect(new Set(shots.map((x) => x.shot_size)).size).toBeGreaterThanOrEqual(4);
  });

  it("the last line is set where line 1 is and mirrors its shot", async () => {
    const s = script(10);
    s.scenes[9] = { ...s.scenes[9], setting: "the kitchen at noon", shot_size: "wide", subject: "object" };
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r = await writeReelScript(input10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const last = r.script.scenes[9];
    expect(splitIdea(last.idea).setting).toBe("the nursery at 3 a.m");
    expect({ shot_size: last.shot_size, subject: last.subject }).toEqual({ shot_size: "close", subject: "both" });
  });

  it("an ending whose idea names its own place keeps its setting (no contradiction); the subject still mirrors", async () => {
    const s = script(10);
    s.scenes[9] = { ...s.scenes[9], idea: "The mom doll tucks the baby doll into his bed.", setting: "the dim bedroom at night", subject: "mom" };
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r = await writeReelScript(input10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.script.scenes[9].idea).toBe("The mom doll tucks the baby doll into his bed — the dim bedroom at night");
    expect(r.script.scenes[9].subject).toBe("both");
  });

  it("a size the idea implies is never overridden; the idea text is never changed by the repair", async () => {
    const s = script(10);
    s.scenes[5] = { ...s.scenes[5], idea: "Looking down at the baby doll's pleading face", shot_size: "wide", subject: "baby" };
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r = await writeReelScript(input10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.script.scenes[5].shot_size).toBe("pov");
    expect(splitIdea(r.script.scenes[5].idea).moment).toBe("Looking down at the baby doll's pleading face");
  });

  it("punch: verbatim from its line, at most 4 per reel; time_jump never on line 1", async () => {
    const s = script(10);
    s.scenes = s.scenes.map((x, i) => ({ ...x, punch: i === 0 ? "last time" : i < 7 ? "short" : "spoken phrase", time_jump: i < 2 }));
    s.scenes[3] = { ...s.scenes[3], punch: "not in the line" };
    generateJson.mockResolvedValueOnce({ ok: true, data: s });
    const r = await writeReelScript(input10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.script.scenes.map((x) => x.punch);
    expect(p.filter(Boolean)).toHaveLength(4);
    expect(p[0]).toBe("last time");
    expect(p[3]).toBeNull();
    // the kept ones include one in the last 30 % (the turn)
    expect(p.slice(7).some(Boolean)).toBe(true);
    for (const [i, x] of r.script.scenes.entries()) if (x.punch) expect(x.narration, `${i}`).toContain(x.punch);
    expect(r.script.scenes.map((x) => x.time_jump).slice(0, 3)).toEqual([false, true, false]);
  });
});

describe("Crayon / Red Thread scripts (012): the picture is written to the owner's guide", () => {
  const CRAYON = { id: "crayon", faces: true } as const;
  const RED = { id: "redthread", faces: true } as const;
  const people = {
    adult: "the mom: a young Filipino mother with dark hair in a low bun, a plain cardigan", child: "the baby: a chubby 10-month-old baby boy in a striped romper",
    adult_tag: "Filipino mom, low bun, plain cardigan", child_tag: "chubby baby, striped romper", child_age: "a 10-month-old baby boy",
  };
  const gscene = (n: number, extra: Record<string, unknown> = {}) => {
    const { idea: _i, setting: _s, action: _a, ...rest } = scene(n);
    void _i; void _s; void _a;
    return { ...rest, scene: `The mother hugs the baby tightly by the window, both laughing, moment ${n}. Toys in the foreground, an evening sky behind.`, feeling: "comfort after a long day", thread: "tight", ...extra };
  };
  const gscript = (count: number, over: (n: number) => Record<string, unknown> = () => ({})) =>
    ({ title: "The Last Time You Carry Them", stage: "baby", hook_text: HOOK_TEXT, cast: people, scenes: Array.from({ length: count }, (_, i) => gscene(i, over(i))) });

  it("the prompt: the style's story hints, the guide's [SCENE] rules, feeling (+ thread for Red Thread); no idea / setting / action", () => {
    const c = reelScriptPrompt({ ...input10, theme: CRAYON }).prompt;
    expect(c).toMatch(/THIS STYLE \(the owner's Crayon guide\)/);
    expect(c).toMatch(/"scene": the picture in 2-3 plain sentences/);
    expect(c).toMatch(/look at EACH OTHER/);
    expect(c).toMatch(/exactly ONE gesture between the characters/);
    expect(c).toMatch(/foreground objects .* simple background/);
    expect(c).toMatch(/"feeling": the picture's feeling .*complete 'The feeling is …'/);
    expect(c).not.toMatch(/"idea":|"setting":|"action":|"thread":/);
    expect(c).toMatch(/LINE 1 is the hook/);
    expect(c).toMatch(/NEVER ask viewers to follow/);
    expect(c).toMatch(/The LAST line is the payoff/);
    const r = reelScriptPrompt({ ...input10, theme: RED }).prompt;
    expect(r).toMatch(/THIS STYLE \(the owner's Red Thread guide\)/);
    expect(r).toMatch(/OFW parent/);
    expect(r).toMatch(/NO colour words at all/);
    expect(r).toMatch(/"thread": .*plain\|tight\|stretched\|tangled\|loose/);
    expect(r).toMatch(/describe hair and clothes by shape and pattern ONLY/);
    expect(r).toMatch(/face-free lines are very close detail views of the hands and wrists/);
    expect(reelScriptPrompt({ ...input10, theme: undefined }).prompt).toMatch(/owner's Crayon guide/);   // the default style
  });

  it("the schema asks for scene + feeling (+ thread) instead of idea / setting / action", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: gscript(10) });
    await writeReelScript({ ...input10, theme: RED });
    const items = generateJson.mock.calls[0][0].schema.properties.scenes.items;
    expect(items.required).toEqual(["beat", "narration", "shot_size", "subject", "emotion", "punch", "time_jump", "scene", "feeling", "thread"]);
    expect(items.properties.thread.enum).toEqual(["plain", "tight", "stretched", "tangled", "loose"]);
    expect(items.properties.idea).toBeUndefined();
    generateJson.mockResolvedValueOnce({ ok: true, data: gscript(10) });
    await writeReelScript({ ...input10, theme: CRAYON });
    expect(generateJson.mock.calls[1][0].schema.properties.scenes.items.required).not.toContain("thread");
  });

  it("validates: the cleaned scene becomes the idea, the feeling is kept, Red Thread's thread (or one from the emotion)", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: gscript(10, (n) => (n === 2 ? { thread: "frayed", emotion: "worried" } : n === 3 ? { scene: "Close view of the mother in a red dress waving, looking at the camera. A red thread trails away. The feeling is missing you.", feeling: "" } : {})) });
    const r = await writeReelScript({ ...input10, theme: RED });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.script.scenes;
    // stored like every idea: the closing full stop is trimmed (the builder puts it back)
    expect(s[0]).toMatchObject({ idea: "The mother hugs the baby tightly by the window, both laughing, moment 0. Toys in the foreground, an evening sky behind", feeling: "comfort after a long day", thread: "tight", action: "" });
    expect(s[2].thread).toBe("loose");
    expect(s[3].idea).toBe("The mother in a dress waving");   // line 3 is the mother alone: her look at the viewer goes
    expect(s[3].feeling).toBe("missing you");
    expect(s.every((x) => !/—/.test(x.idea))).toBe(true);
  });

  it("Crayon lines carry a feeling but no thread; a line without a scene is rejected; a long scene keeps whole sentences", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: gscript(10, (n) => (n === 4 ? { feeling: "  " } : n === 5 ? { scene: `${"The mother smiles at the baby with crinkled eyes. ".repeat(14)}` } : {})) });
    const r = await writeReelScript({ ...input10, theme: CRAYON });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.script.scenes[0]).toMatchObject({ feeling: "comfort after a long day", thread: null });
    expect(r.script.scenes[4].feeling).toBe("pure love and warmth");   // tender
    expect(r.script.scenes[5].idea.length).toBeLessThanOrEqual(560);
    expect(r.script.scenes[5].idea.endsWith("with crinkled eyes")).toBe(true);
    generateJson.mockResolvedValueOnce({ ok: true, data: gscript(10, (n) => (n === 2 ? { scene: "" } : {})) });
    expect(await writeReelScript({ ...input10, theme: CRAYON })).toEqual({ ok: false, error: "Line 3 has no picture scene." });
  });
});
