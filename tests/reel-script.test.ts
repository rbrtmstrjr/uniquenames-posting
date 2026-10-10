import { beforeEach, describe, expect, it, vi } from "vitest";
import { shotListIssues } from "@/lib/reels/shots";
import { splitIdea } from "@/lib/reels/prompt";
import { FORMAT_SPECS, REEL_FORMATS, type ReelFormat } from "@/lib/reels/formats";

const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const {
  reelScriptPrompt, writeReelScript, reelWordBudget, validateReelScript, REEL_SCRIPT_MODEL, REEL_SCRIPT_TIMEOUT_MS, ALREADY_MADE_CAP, LINE_MAX_WORDS,
  REEL_SECONDS, OUTRO_RE, quoteCount, WORDS_PER_SECOND,
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
// line 4 carries the exact words to say (a quote may hold "me": the mom says it, not the narrator)
const QUOTE_LINE = `Say "you are safe with me," then whisper "I'm here."`;
// every filler line is different (the validator refuses a line that repeats an earlier one): 10 words each
const NOUNS = ["socks", "spoons", "blankets", "pillows", "crayons", "slippers", "bottles", "buttons", "mangoes", "puzzles", "kites", "jars",
  "drums", "bubbles", "teacups", "ribbons", "pebbles", "shells", "lanterns", "marbles", "noodles", "blocks", "boats", "bells", "combs",
  "towels", "stars", "rattles", "baskets", "wagons", "whistles", "candles", "mittens", "feathers", "beads", "cookies", "trumpets", "kettles", "fans", "ducks"];
const scene = (n: number, narration = n === 0 ? HOOK : n === 3 ? QUOTE_LINE : `Line number ${n} is a short spoken phrase about ${NOUNS[n]}.`) => ({
  beat: n === 0 ? "hook" : "build", narration, idea: `The mom doll rocks the baby doll, moment ${n}.`, setting: n === 0 ? "the nursery at 3 a.m." : `the sala, moment ${n}`,
  emotion: "tender", action: "rocks gently, both arms wrapped around the baby doll",
  shot_size: SHOTS[n % 10][0], subject: SHOTS[n % 10][1], punch: "", time_jump: false,
});
const script = (count: number, over: Record<string, unknown> = {}) =>
  ({ title: "The Last Time You Carry Them", stage: "baby", format: "problem_fix", hook_text: HOOK_TEXT, cast, scenes: Array.from({ length: count }, (_, i) => scene(i)), ...over });
// the playbook tests below run on an old theme (Knitted Doll); the guide styles have their own block at the end
const KNITTED = { id: "knitted", faces: false } as const;
const PF = "problem_fix" as const;
const input10 = { maxScenes: 10, alreadyMade: [], theme: KNITTED, format: PF };
const input30 = { maxScenes: 30, alreadyMade: [], theme: KNITTED, format: PF };

describe("reelScriptPrompt", () => {
  it("a picked topic card's hook is suggested as line 1 (never without a topic)", () => {
    const { prompt } = reelScriptPrompt({ topic: "The 2-Choice Rule", maxScenes: 40, alreadyMade: [], format: "named_method", hookHint: 'Stop the fight: try "red cup or blue cup?"' });
    expect(prompt).toContain(`Suggested hook: "Stop the fight: try 'red cup or blue cup?'". Open with this hook or a stronger version of it`);
    expect(reelScriptPrompt({ topic: "The 2-Choice Rule", maxScenes: 40, alreadyMade: [], format: "named_method" }).prompt).not.toContain("Suggested hook");
    expect(reelScriptPrompt({ maxScenes: 40, alreadyMade: [], format: "named_method", hookHint: "x y z" }).prompt).not.toContain("Suggested hook");
  });

  it("carries the topic, the format and the line range", () => {
    const { system, prompt } = reelScriptPrompt({ topic: "teething at night", maxScenes: 32, alreadyMade: [], format: PF });
    expect(prompt).toContain("Topic: teething at night");
    expect(prompt).toContain("14-32 lines");
    expect(prompt).toContain("FORMAT: Problem, why, fix (problem_fix)");
    expect(system).toMatch(/moms of babies and young kids \(0-7\) around the world; most are in the Philippines, others in the US, Africa, Australia/);
    expect(system).not.toMatch(/Filipino moms|loves her 'anak'|local detail|lola wisdom/);
    expect(system).toMatch(/early years/);
    expect(system).toMatch(/teaches ONE thing/);
    expect(system).not.toMatch(/storyteller/);
  });

  it("each format's beats are in the prompt verbatim, in order; never another format's", () => {
    for (const f of REEL_FORMATS) {
      const { prompt } = reelScriptPrompt({ ...input10, format: f });
      let at = -1;
      for (const beat of FORMAT_SPECS[f].beats) {
        const i = prompt.indexOf(beat);
        expect(i, `${f}: ${beat}`).toBeGreaterThan(at);
        at = i;
      }
      for (const g of REEL_FORMATS) if (g !== f) expect(prompt).not.toContain(FORMAT_SPECS[g].beats[0]);
      expect(prompt).toContain(`at least ${FORMAT_SPECS[f].minQuotes} quoted phrase`);
      expect(prompt).toContain(`"format": "${f}"`);
    }
  });

  it("a blank topic asks Gemini to choose one specific, useful early-years topic", () => {
    const { prompt } = reelScriptPrompt({ topic: "  ", maxScenes: 40, alreadyMade: [], format: "say_this" });
    expect(prompt).toMatch(/CHOOSE one specific, useful topic/);
  });

  it("lists every already-made title with its stage, or says none yet; capped at the newest", () => {
    const made = [{ title: "The Last Time You Carry Them", stage: "baby" }, { title: "Tiny Socks, Big Love" }];
    const { prompt } = reelScriptPrompt({ maxScenes: 40, alreadyMade: made, format: PF });
    expect(prompt).toContain("- The Last Time You Carry Them (baby)\n");
    expect(prompt).toContain("- Tiny Socks, Big Love\n");
    expect(prompt).toMatch(/newborn\|baby\|toddler\|preschooler/);
    expect(reelScriptPrompt({ maxScenes: 40, alreadyMade: [], format: PF }).prompt).toContain("(none yet");
    const many = Array.from({ length: ALREADY_MADE_CAP + 5 }, (_, i) => ({ title: `Reel title ${i}` }));
    const p = reelScriptPrompt({ maxScenes: 40, alreadyMade: many, format: PF }).prompt;
    expect(p).toContain(`- Reel title ${ALREADY_MADE_CAP - 1}\n`);
    expect(p).not.toContain(`- Reel title ${ALREADY_MADE_CAP}\n`);
  });

  it("the 60-90 s length: word budget, the 65-80 s aim, line count, short lines, never 'camera'", () => {
    expect(REEL_SECONDS).toEqual({ lo: 60, hi: 90, floor: 15 });
    const { prompt } = reelScriptPrompt(input30);
    // the calm line-by-line narrator (worker 2.6.0) speaks ~160 words a minute, pauses included
    expect(prompt).toContain("narration for a 60-90 second reel at about 2.7 words per second = 160-240 words");
    expect(prompt).toContain("AIM for 173-213 words (about 65-80 seconds)");
    expect(prompt).toContain("Under 160 words (under 60 seconds) is TOO SHORT");
    expect(prompt).toContain("14-30 lines");
    expect(prompt).toMatch(/CALM PACE: .*short pause after every line.*keep every beat and step of the format.*fewer, tighter words/);
    expect(prompt).toContain("Every line is one image on screen for about 2-5 seconds");
    expect(reelScriptPrompt({ ...input30, speed: 1.05 }).prompt).toContain("60-90 second reel at about 2.8 words per second = 168-252 words");
    expect(prompt).toMatch(/Sentences of 4-12 words \(never more than 15\)/);
    expect(prompt).toMatch(/BEFORE ANSWERING, COUNT/);
    expect(prompt).not.toMatch(/\bcamera\b/i);
  });

  it("value-first rules: second person, exact words in quotes, one soft anchor, banned list, no tagline, self-check", () => {
    const { prompt } = reelScriptPrompt(input10);
    expect(prompt).toMatch(/LINE 1 is the hook, spoken in the first half-second: at most 12 words/);
    expect(prompt).toMatch(/second person/);
    expect(prompt).toMatch(/NEVER the first person/);
    expect(prompt).toMatch(/EXACT WORDS .* in double quotes/);
    expect(prompt).toMatch(/ONE soft anchor/);
    expect(prompt).toMatch(/Never invent studies, numbers, percentages, quotes or experts/);
    expect(prompt).toMatch(/BANNED anywhere: .*'Welcome back'.*'Today I want to talk about'.*'In this video'.*'Let me tell you'/);
    expect(prompt).toMatch(/'see you next time', 'thanks for watching', 'next video'/);
    expect(prompt).toMatch(/like, comment, share, tag, follow, save, subscribe or vote/);
    expect(prompt).toMatch(/'watch till the end'/);
    expect(prompt).toMatch(/No tagline/);
    expect(prompt).toMatch(/SELF-CHECK/);
    expect(prompt).toMatch(/PATTERNS only: .*Write fresh words for THIS topic and never reuse an example sentence/);
    expect(prompt).toMatch(/"hook_text".*at most 10 words, it COMPLEMENTS line 1/);
    expect(prompt).toMatch(/hook_text.*ideally at most 8 words and 45 characters/);
    // the old vignette rules are gone
    expect(prompt).not.toMatch(/identity line|EMOTIONAL TURN|loops back to line 1|ONE short STORY/);
  });

  it("retention for the longer reel: open loops, a re-hook every 10-15 s, substance never padding", () => {
    const { prompt } = reelScriptPrompt(input30);
    expect(prompt).toMatch(/RETENTION FOR A 60-90 SECOND REEL/);
    expect(prompt).toMatch(/OPEN LOOP/);
    expect(prompt).toMatch(/A RE-HOOK every 10-15 seconds \(about every 4-6 lines\)/);
    expect(prompt).toMatch(/Here's the part nobody tells you/);
    expect(prompt).toMatch(/MORE SUBSTANCE, NEVER PADDING/);
    expect(prompt).toMatch(/no recap \('as I said', 'like I said', 'to sum up', 'let's recap'\)/);
    expect(prompt).toMatch(/SELF-CHECK.*a re-hook every 4-6 lines.*no line repeats an earlier one/s);
    expect(prompt).not.toMatch(/re-hook every 8-12 seconds/);
    // scene_lesson: the pivot line is part of the self-check (the validator wants it by line 5)
    expect(reelScriptPrompt({ ...input30, format: "scene_lesson" }).prompt).toMatch(/SELF-CHECK.*the pivot \('Here's what's really happening\.'\) is line 5 or earlier/s);
    expect(prompt).not.toMatch(/the pivot \('Here's/);
  });

  it("health topics: soft wording and one generic safety line; other topics never get it", () => {
    const h = reelScriptPrompt({ ...input10, format: "lola_science", topic: "kulob to sweat out a fever", topicHealth: true }).prompt;
    expect(h).toMatch(/HEALTH TOPIC/);
    expect(h).toMatch(/SAFETY LINE/);
    expect(h).toMatch(/no diagnosis, no symptom checklists, no doses/);
    expect(h).toMatch(/Never explain how the body works/);
    expect(reelScriptPrompt(input10).prompt).not.toMatch(/HEALTH TOPIC/);
  });

  it("on-screen labels: optional, short, never on line 1", () => {
    const { prompt } = reelScriptPrompt(input10);
    expect(prompt).toMatch(/"on_screen".*at most 8 words/);
    expect(prompt).toMatch(/"on_screen".*3-8 lines per reel/);
    expect(prompt).toMatch(/ALWAYS "" on line 1/);
  });

  it("the pictures act out the advice, with only the parent and the child", () => {
    const { prompt } = reelScriptPrompt({ ...input10, theme: { id: "crayon", faces: true } });
    expect(prompt).toMatch(/PICTURES SHOW THE ADVICE/);
    expect(prompt).toMatch(/never grandma, a sibling/);
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

describe("reelWordBudget (60-90 s at 2.67 words/s × speed: the line-by-line voice, worker 2.6.0)", () => {
  it("1×: 160-240 words (aim 173-213 = 65-80 s); at least 60 s is required; few images shrink it, never under 18 s of speech", () => {
    expect(WORDS_PER_SECOND).toBe(2.67);   // retuned Gacrux measured ~155-160 wpm with its pauses
    expect(reelWordBudget(40)).toEqual({
      lo: 160, hi: 240, aimLo: 173, aimHi: 213, minScenes: 14, maxLines: 35, minWords: 160, maxWords: 264,
      secLo: 60, secHi: 90, secAimLo: 65, secAimHi: 80, wps: 2.7,
    });
    // 60 s fits the owner's 40 images (and 30) with short lines
    expect(reelWordBudget(30)).toMatchObject({ lo: 160, hi: 240, minScenes: 14, maxLines: 30, minWords: 160 });
    expect(160 / 30).toBeLessThan(LINE_MAX_WORDS);
    expect(240 / 14).toBeLessThanOrEqual(LINE_MAX_WORDS + 3);   // the fewest lines still read as short lines
    expect(reelWordBudget(10)).toMatchObject({ lo: 80, hi: 120, minScenes: 7, maxLines: 10, minWords: 80, maxWords: 132 });
    const fast = reelWordBudget(10, 1.25);
    expect(fast.lo).toBe(80);   // 10 images x 8 words (18 s at 3.34 words/s would be only 61)
    expect(fast.minWords / (2.67 * 1.25)).toBeGreaterThanOrEqual(15);
    expect(reelWordBudget(40, 1.05)).toMatchObject({ lo: 168, hi: 252, minWords: 168, maxWords: 277, secLo: 60, secHi: 90, secAimLo: 65, secAimHi: 80, wps: 2.8 });
  });
});

describe("the value-first validator", () => {
  const val = (raw: unknown, format: ReelFormat = PF, o: { health?: boolean; maxScenes?: number } = {}) =>
    validateReelScript(raw, o.maxScenes ?? 10, 1, "knitted", { format, health: o.health });
  const withLine = (i: number, narration: string, extra: Record<string, unknown> = {}) => {
    const s = script(10);
    s.scenes[i] = { ...s.scenes[i], narration, ...extra };
    return s;
  };

  it("counts quoted phrases (straight or curly double quotes)", () => {
    expect(quoteCount(['Say "Walking feet, please." then wait.', "Try “Red cup or blue cup?”", "no quotes here"])).toBe(2);
    expect(quoteCount(['"One" and "two" in a line'])).toBe(2);
    expect(quoteCount(["It's mama's turn, isn't it?"])).toBe(0);
  });

  it("greetings and outros are refused on every line", () => {
    expect(val(withLine(5, "Hello mama, here is the second step."))).toEqual({ ok: false, error: "Line 6 is a greeting or an outro." });
    for (const outro of ["See you in the next video, mama.", "Thanks for watching, and rest well.", "Until next time, be gentle with you."]) {
      expect(OUTRO_RE.test(outro), outro).toBe(true);
      expect(val(withLine(9, outro)), outro).toEqual({ ok: false, error: "Line 10 is a greeting or an outro." });
    }
    expect(OUTRO_RE.test("Next time he throws it, try this.")).toBe(false);
  });

  it("calls to action anywhere: like / comment / share / tag / follow / save / vote / watch till the end", () => {
    for (const cta of ["Watch till the end for the last step.", "Vote below: keep it or let go?", "Like this if it helped your home.", "Tired mama? Like this video and rest."]) {
      expect(val(withLine(6, cta)), cta).toEqual({ ok: false, error: "Line 7 asks viewers to follow, comment, tag or share." });
    }
    // "like this" introducing the words to say is no call to action (the longer reels say it often)
    for (const ok of ['Say it like this: "Bath, then cuddles."', "It sounds like this, every single night.", "It feels like this is never ending."]) {
      expect(val(withLine(6, ok)).ok, ok).toBe(true);
    }
  });

  it("first-person narration is refused; the mom's quoted words and 'we all' are fine", () => {
    for (const fp of ["I tried this with my own son last week.", "We learned this the hard way, mama.", "It works for us every single night.", "My mom always said this to our family."]) {
      expect(val(withLine(5, fp)), fp).toMatchObject({ ok: false, error: expect.stringMatching(/^Line 6 speaks as I \/ we \("\w+"\): talk to the mom as you\.$/) });
    }
    expect(val(withLine(5, "I tried this with my own son last week."))).toEqual({ ok: false, error: 'Line 6 speaks as I / we ("I"): talk to the mom as you.' });
    // the mom's words in single quotes are hers too
    expect(val(withLine(5, "Then whisper, 'I'm here, we're okay.' and wait.")).ok).toBe(true);
    expect(val(withLine(5, 'Say "I see you, I\'m here with you" again.')).ok).toBe(true);
    // "we all" only in the hook (line 1): "We all grew up hearing this" later on is the narrator's own story
    expect(val(withLine(0, "Three things we all say make it worse.")).ok).toBe(true);
    expect(val(withLine(5, "We all grew up hearing this rule."))).toEqual({ ok: false, error: 'Line 6 speaks as I / we ("We"): talk to the mom as you.' });
    // "I" only as a word: "It" / "Is" are fine
    expect(val(withLine(5, "It is hard. Is it always this loud?")).ok).toBe(true);
  });

  it("fewer quoted phrases than the format needs is refused", () => {
    const none = script(10);
    none.scenes[3] = scene(3, "Line number 3 is a short spoken phrase for mama.");
    expect(val(none)).toEqual({ ok: false, error: "The script needs the exact words to say in quotes (at least 2, found 0)." });
    expect(val(script(10), "say_this")).toEqual({ ok: false, error: "The script needs the exact words to say in quotes (at least 6, found 2)." });
    expect(val(script(10), "named_method")).toEqual({ ok: false, error: "The script needs the exact words to say in quotes (at least 4, found 2)." });
  });

  it("a health topic needs a safety line (doctor / pediatrician)", () => {
    expect(val(script(10), PF, { health: true })).toEqual({ ok: false, error: "A health topic needs a safety line (when to call the doctor)." });
    expect(val(withLine(8, "If you're worried, call your pediatrician today."), PF, { health: true }).ok).toBe(true);
  });

  it("too many words for 90 s is refused", () => {
    const long = script(10);
    long.scenes = long.scenes.map((x, i) => (i === 0 || i === 3 ? x : { ...x, narration: "Line number five is a much longer spoken phrase for you, mama, every single night." }));
    expect(val(long)).toEqual({ ok: false, error: "Script too long: 138 words (at most 132)." });
  });

  it("padding is refused: a recap / filler phrase, or a line that repeats an earlier one", () => {
    for (const pad of ["To sum up, get low and name the feeling.", "Let's recap the three steps one more time.", "Like I said, the words matter most here.", "As we saw, naming it calms the storm."]) {
      expect(val(withLine(6, pad)), pad).toMatchObject({ ok: false, error: expect.stringMatching(/^Line 7 is filler or a recap/) });
    }
    expect(val(withLine(6, "To sum up, get low and name the feeling."))).toEqual({ ok: false, error: 'Line 7 is filler or a recap ("To sum up"): every line must say something new.' });
    // the same line again, or with one word swapped
    expect(val(withLine(7, "Line number 2 is a short spoken phrase about blankets."))).toEqual({ ok: false, error: "Line 8 repeats line 3: every line must say something new." });
    expect(val(withLine(7, "Line number 2 is a short spoken phrase about kittens."))).toEqual({ ok: false, error: "Line 8 repeats line 3: every line must say something new." });
    // a short refrain ("Same words. Every time.") may come back; parallel steps with their own words are fine
    const refrain = withLine(5, "Same words. Every time.");
    refrain.scenes[8] = { ...refrain.scenes[8], narration: "Same words. Every time." };
    expect(val(refrain).ok).toBe(true);
    const swaps = withLine(4, 'Instead of "Stop crying," say "You\'re sad."');
    swaps.scenes[6] = { ...swaps.scenes[6], narration: 'Instead of "Stop hitting," say "Gentle hands."' };
    expect(val(swaps).ok).toBe(true);
  });

  it("on_screen: kept when short; dropped on line 1, when too long or empty; never rejected", () => {
    const s = script(10);
    s.scenes[0] = { ...s.scenes[0], on_screen: "THE 5-WORD RULE" } as never;
    s.scenes[2] = { ...s.scenes[2], on_screen: "  1/3 · “You're mad.”  " } as never;
    s.scenes[4] = { ...s.scenes[4], on_screen: "one two three four five six seven eight nine" } as never;
    s.scenes[5] = { ...s.scenes[5], on_screen: "x".repeat(81) } as never;
    s.scenes[6] = { ...s.scenes[6], on_screen: " " } as never;
    const r = val(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.script.scenes.map((x) => x.on_screen)).toEqual([null, null, "1/3 · “You're mad.”", null, null, null, null, null, null, null]);
  });

  it("at most 8 lines keep a label (the first ones)", () => {
    const s = script(10);
    s.scenes = s.scenes.map((x, i) => ({ ...x, on_screen: `Step ${i}` })) as never;
    const r = val(s);
    expect(r.ok && r.script.scenes.map((x) => x.on_screen)).toEqual([null, "Step 1", "Step 2", "Step 3", "Step 4", "Step 5", "Step 6", "Step 7", "Step 8", null]);
  });

  it("the hook card names this format's thing, never another format's series name", () => {
    const sl = reelScriptPrompt({ ...input10, format: "scene_lesson" }).prompt;
    expect(sl).not.toContain("SAY THIS, NOT THAT");
    expect(reelScriptPrompt({ ...input10, format: "say_this" }).prompt).toContain("SAY THIS, NOT THAT");
    expect(sl).toMatch(/never reuse an example sentence, an example's method name or an example's fix/);
  });

  it("each format gets its own label pattern; 'Verdict' only for the myth check", () => {
    expect(reelScriptPrompt({ ...input10, format: "lola_science" }).prompt).toContain("Verdict: let go, gently");
    for (const f of ["named_method", "say_this", "scene_lesson", "problem_fix"] as const) {
      expect(reelScriptPrompt({ ...input10, format: f }).prompt, f).not.toMatch(/'Verdict:/);
    }
  });

  it("a title written like an id is turned back into words", () => {
    const r = val(script(10, { title: "grandma_science_never_bathe" }));
    expect(r.ok && r.script.title).toBe("grandma science never bathe");
  });

  it("the script carries the requested format", () => {
    const r = val(script(10, { format: "say_this" }), PF);
    expect(r.ok && r.script.format).toBe(PF);
  });

  it("accepts a valid sample of every format", () => {
    const fixtures: Record<ReelFormat, string[]> = {
      named_method: ['Stop saying "calm down." Try the 5-Word Rule.', "Mid-tantrum, long sentences just bounce off a toddler.",
        "Naming the feeling helps the brain settle. Here's how.", 'One. Get low and name it: "You\'re mad. Tower fell."',
        "Two. Wait quietly and count to ten in your head.", 'Three. Offer one small choice: "Build again, or hug first?"',
        "No lecture, because they calm faster when they feel seen.", "Five words for big feelings. That's the 5-Word Rule.",
        'So tonight, try "You\'re sad. Bath is done." once.', "Small words, and a calmer bedtime for both of you."],
      say_this: ["Three things we all say that make tantrums longer.", "Words tell a toddler where to look next.",
        'Instead of "Calm down," say "You\'re so mad."', "Naming it helps the big feeling pass faster.",
        'Instead of "Stop crying," say "I\'m right here."', "Crying is how small bodies let stress out.",
        'Instead of "You\'re fine," say "That hurt, huh?"', "Feeling believed is what lets them move on.",
        "Bonus: say less, sit closer, and breathe slowly.", "Small words make a big change in your home."],
      lola_science: ["Grandma said never bathe a sick child. Doctors say otherwise.", "Grandma wanted to keep you warm and safe.",
        "Today, pediatricians say a lukewarm bath can help a fever.", "It cools the skin gently and helps them rest.",
        'Use lukewarm water and say "Quick bath, then cuddles."', "Dry them fast and dress them in light clothes.",
        'Offer small sips often and say "Sip, then cuddle."', "If you're worried, call your pediatrician right away.",
        "Keep it or let go? This one: let go, gently.", "Grandma's love stays. Only the old rule goes."],
      scene_lesson: ['Your toddler throws his shoe. You\'re late. Don\'t say "Stop it."', "The car seat is waiting and the shoe is under the sofa.",
        "Here's what's really happening right now.", "Switching tasks is hard for a three-year-old brain.",
        "He isn't fighting you. He is stuck in the moment.", 'Try a two-minute warning, then a job: "You carry the keys."',
        "A job gives his hands and his brain somewhere to go.", "Leaving becomes his idea, not your order.",
        "Tomorrow, give the warning before the shoes come out.", "Late mornings get softer when he feels useful."],
      problem_fix: ["Bedtime takes an hour? It's usually not the sleep.", "You're tired, and the stalling feels endless every night.",
        "For your toddler, bedtime feels like a long goodbye.", "More water, one more book, one more hug.",
        'Try "Last 3 Things": last hug, last song, last "I love you."', "Same three things, in the same order, every night.",
        "The routine tells the goodbye exactly when it ends.", "So the stalling has nowhere left to go.",
        "Tonight, try it once. Same three, same order.", "A calmer goodnight, and more of your evening back."],
    };
    for (const f of REEL_FORMATS) {
      const s = script(10, { format: f });
      s.scenes = s.scenes.map((x, i) => ({ ...x, narration: fixtures[f][i], punch: "" }));
      const r = val(s, f, { health: f === "lola_science" });
      expect(r, f).toMatchObject({ ok: true });
    }
  });
});

describe("writeReelScript", () => {
  it("uses the script model and returns a typed script with the hook card, tags and the v2 per-line fields", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: script(24) });
    const r = await writeReelScript(input30);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.script).toMatchObject({ title: "The Last Time You Carry Them", stage: "baby", format: PF, hook_text: HOOK_TEXT, cast: { ...cast, child_age: "a baby" } });
    expect(r.script.scenes).toHaveLength(24);
    expect(r.script.scenes[0]).toEqual({
      beat: "hook", narration: HOOK, idea: "The mom doll rocks the baby doll, moment 0 — the nursery at 3 a.m", emotion: "tender",
      action: "rocks gently, both arms wrapped around the baby doll", shot_size: "close", subject: "both", punch: null, time_jump: false, on_screen: null,
    });
    const arg = generateJson.mock.calls[0][0];
    expect(arg.model).toBe(REEL_SCRIPT_MODEL);
    expect(arg.timeoutMs).toBe(REEL_SCRIPT_TIMEOUT_MS);
    const items = arg.schema.properties.scenes.items;
    expect(items.required).toEqual(["beat", "narration", "idea", "setting", "shot_size", "subject", "emotion", "action", "punch", "time_jump", "on_screen"]);
    expect(items.properties.on_screen).toMatchObject({ type: "STRING", nullable: true });
    expect(arg.schema.properties.format.enum).toEqual([...REEL_FORMATS]);
    expect(arg.schema.required).toContain("format");
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
    generateJson.mockResolvedValueOnce({ ok: true, data: script(12) });
    const r = await writeReelScript(input10);
    expect(r.ok && r.script.scenes.length).toBe(10);
    generateJson.mockResolvedValueOnce({ ok: true, data: script(13) });
    expect(await writeReelScript(input30)).toEqual({ ok: false, error: "Script too short: 13 scenes (needs at least 14)." });
    // 60 s is the minimum: 16 lines that stop at 158 words (59 s at the calm pace) are refused
    generateJson.mockResolvedValueOnce({ ok: true, data: script(16) });
    expect(await writeReelScript(input30)).toEqual({ ok: false, error: "Script too short: 158 words (needs at least 160)." });
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
    const s = script(24);
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
    // proof run 3: a calm hands-only detail of the toddler came out photographic; an off-screen look drew strangers
    expect(c).toMatch(/every picture of a person shows their face with a BIG, exaggerated expression/);
    expect(c).not.toMatch(/face-free lines are very close detail views of their hands/);
    expect(c).toMatch(/subject object .* on at most 1 line/);
    expect(c).toMatch(/never looking off-screen/);
    expect(c).toMatch(/LINE 1 is the hook/);
    expect(c).toMatch(/NEVER ask viewers to like/);
    expect(c).toMatch(/The LAST line is the warm close/);
    const r = reelScriptPrompt({ ...input10, theme: RED }).prompt;
    expect(r).toMatch(/THIS STYLE \(the owner's Red Thread guide\)/);
    expect(r).toMatch(/a parent working abroad or far away \(away for work, deployed\)/);
    expect(r).not.toMatch(/OFW/);
    expect(r).toMatch(/NO colour words at all/);
    expect(r).toMatch(/Keep the wrists in view/);
    expect(r).toMatch(/"thread": .*plain\|tight\|stretched\|tangled\|loose/);
    expect(r).toMatch(/describe hair and clothes by shape and pattern ONLY/);
    expect(r).toMatch(/face-free lines are very close detail views of the hands and wrists/);
    expect(reelScriptPrompt({ ...input10, theme: undefined }).prompt).toMatch(/owner's Crayon guide/);   // the default style
  });

  it("the schema asks for scene + feeling (+ thread) instead of idea / setting / action", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: gscript(10) });
    await writeReelScript({ ...input10, theme: RED });
    const items = generateJson.mock.calls[0][0].schema.properties.scenes.items;
    expect(items.required).toEqual(["beat", "narration", "shot_size", "subject", "emotion", "punch", "time_jump", "on_screen", "scene", "feeling", "thread"]);
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

  it("a guide scene's wording ('one tiny hand reaching', 'looking down at') never overrides the shot size", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: gscript(10, (n) => (n === 3 ? { scene: "The mother looking down at the baby, one tiny hand reaching toward her face. A blanket in the foreground." } : {})) });
    const r = await writeReelScript({ ...input10, theme: CRAYON });
    expect(r.ok && r.script.scenes[3].shot_size).toBe(SHOTS[3][0]);
  });

  it("(no scene) is rejected", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: gscript(10, (n) => (n === 2 ? { scene: "" } : {})) });
    expect(await writeReelScript({ ...input10, theme: CRAYON })).toEqual({ ok: false, error: "Line 3 has no picture scene." });
  });
});

describe("health accuracy, verified anchors, the scene pivot (review fixes)", () => {
  const FACTS = ["A bath is fine for comfort if your child wants one: lukewarm water, never cold.", "Never add alcohol to the bath or rub alcohol on the skin."];
  const SAFETY = "Baby under 3 months with a fever, or very sick? Call your doctor.";
  const val = (raw: unknown, format: ReelFormat = PF, o: { health?: boolean; anchor?: string } = {}) =>
    validateReelScript(raw, 10, 1, "knitted", { format, health: o.health, anchor: o.anchor });
  const withLine = (i: number, narration: string, over: Record<string, unknown> = {}) => {
    const s = script(10, over);
    s.scenes[i] = { ...s.scenes[i], narration };
    return s;
  };

  it("a bank health topic: medical claims may ONLY restate its vetted facts; its safety line is given", () => {
    const p = reelScriptPrompt({ ...input10, format: "lola_science", topic: "Lola said: never bathe a sick child", topicHealth: true, topicFacts: FACTS, topicSafety: SAFETY }).prompt;
    expect(p).toMatch(/MEDICAL FACTS .*the ONLY medical claims/);
    for (const f of FACTS) expect(p).toContain(`- ${f}`);
    expect(p).toContain(SAFETY);
    expect(p).toMatch(/no mechanisms/);
  });

  it("a typed health topic (no vetted facts): claims stay general", () => {
    const p = reelScriptPrompt({ ...input10, topic: "Baby has a fever", topicHealth: true }).prompt;
    expect(p).toMatch(/keep every medical claim general/);
    expect(p).not.toMatch(/MEDICAL FACTS/);
  });

  it("a verified anchor is offered; without one, a plain anchor and never a coined expert term", () => {
    expect(reelScriptPrompt({ ...input10, topicAnchor: "naming the feeling out loud helps a child calm down — child experts" }).prompt)
      .toContain("use this checked one, in your own plain words ('Child experts say …'): naming the feeling out loud helps a child calm down — child experts");
    const p = reelScriptPrompt(input10).prompt;
    expect(p).toMatch(/never coin a term and attribute it to experts/);
    expect(p).toMatch(/Your own tip names .* are fine/);
  });

  it("refuses body-mechanism claims (temperature, hormones) on any line", () => {
    for (const bad of ["It brings their body temperature down gently.", "Cold water causes shivering, which raises their temperature.",
      "Their tiny bodies pump out cortisol to stay awake.", "A warm bath helps lower a mild fever safely.", "Adrenaline keeps them bouncing at night."]) {
      expect(val(withLine(5, bad)), bad).toEqual({ ok: false, error: "Line 6 explains how the body works (temperature, hormones): keep to the vetted facts." });
    }
    expect(val(withLine(5, "Use lukewarm water, never cold, just for comfort.")).ok).toBe(true);
  });

  it("refuses an expert-attributed term that isn't verified; vetted terms and the topic's anchor are fine", () => {
    expect(val(withLine(5, "Many sleep experts call it a wakeful window."))).toEqual({ ok: false, error: "Line 6 says experts call it something unverified: use a plain anchor." });
    // a named technique is jargon now (plain lessons, 2026-10-10)
    expect(val(withLine(5, "Psychologists call this labeled praise."))).toEqual({ ok: false, error: 'Line 6 uses expert jargon ("labeled praise"): say it in plain everyday words.' });
    expect(val(withLine(5, "Pediatricians call it watching together."), PF, { anchor: "watching together — the American Academy of Pediatrics" }).ok).toBe(true);
    // the page's own tip name, not attributed to experts
    expect(val(withLine(5, "It's called the Two-Choice Rule, a tip to try.")).ok).toBe(true);
  });

  it("scene_lesson: line 1 names the problem (no reassurance) and the pivot comes by line 5 (the scene may take 2-3 lines)", () => {
    const sl = (lines: Record<number, string>) => {
      const s = script(10, { format: "scene_lesson" });
      for (const [i, n] of Object.entries(lines)) s.scenes[Number(i)] = { ...s.scenes[Number(i)], narration: n };
      return val(s, "scene_lesson");
    };
    expect(sl({ 2: "Here's what's really happening." }).ok).toBe(true);
    expect(sl({ 4: "Here's what's really happening." }).ok).toBe(true);
    expect(sl({ 5: "Here's what's really happening." })).toEqual({ ok: false, error: "The pivot (\"Here's what's really happening\") must come by line 5." });
    expect(sl({ 0: "Your toddler walks away from calls. Don't feel bad.", 2: "Here's why." })).toEqual({ ok: false, error: "Line 1 must name the problem or the mistake, not reassure." });
  });

  it("on-screen labels in capitals become sentence case", () => {
    const s = script(10);
    s.scenes[2] = { ...s.scenes[2], on_screen: "HERE IS THE REAL REASON" } as never;
    s.scenes[4] = { ...s.scenes[4], on_screen: "1/3 · GET LOW" } as never;
    s.scenes[5] = { ...s.scenes[5], on_screen: 'SAY: "SHOW MAMA YOUR TRUCK"' } as never;
    s.scenes[6] = { ...s.scenes[6], on_screen: "Say: \"Walking feet\"" } as never;
    const r = val(s);
    expect(r.ok && [2, 4, 5, 6].map((i) => r.script.scenes[i].on_screen)).toEqual(["Here is the real reason", "1/3 · Get low", 'Say: "Show mama your truck"', 'Say: "Walking feet"']);
  });
});

describe("global audience and plain lessons (owner, 2026-10-10)", () => {
  const val = (raw: unknown, format: ReelFormat = PF) => validateReelScript(raw, 10, 1, "knitted", { format });
  const withLine = (i: number, narration: string, over: Record<string, unknown> = {}) => {
    const s = script(10, over);
    s.scenes[i] = { ...s.scenes[i], narration };
    return s;
  };

  it("the prompt speaks to moms around the world in simple English, with no Filipino guidance left", () => {
    const { system, prompt } = reelScriptPrompt({ ...input10, theme: { id: "crayon", faces: true } });
    expect(system).toMatch(/everyday family life anywhere \(home, bedtime, bath time, mealtime, the park, the store, drop-off, a family visit\)/);
    expect(system).toMatch(/simple, warm English anyone understands/i);
    expect(system).not.toMatch(/American English|US spelling|car seat|Thanksgiving|dollars/);
    expect(system).toMatch(/SIMPLE GLOBAL ENGLISH \(CRITICAL\): never a Filipino or Tagalog word or Taglish/);
    expect(system).toMatch(/Grandparents are Grandma and Grandpa/);
    for (const x of [system, prompt]) expect(x).not.toMatch(/Filipino moms|lola wisdom|'anak' fiercely|the sala on|a jeepney at|OFW|local detail/);
    expect(reelScriptPrompt(input10).prompt).toMatch(/'the living room on a rainy afternoon', 'the park at dusk'/);
    expect(reelScriptPrompt(input10).prompt).not.toMatch(/jeepney|the sala/);
  });

  it("the prompt asks for plain, simple, practical lessons with good / bad examples", () => {
    const { system } = reelScriptPrompt(input10);
    expect(system).toMatch(/PLAIN, SIMPLE LESSONS \(CRITICAL\)/);
    expect(system).toMatch(/gets it on the first listen/);
    expect(system).toMatch(/5th-6th grade reading level/);
    expect(system).toMatch(/one idea per line/);
    expect(system).toMatch(/Child experts say naming the feeling helps kids calm down/);
    expect(system).toMatch(/never name a technique, study, therapy/);
    expect(system).toMatch(/affect labeling, Parent-Child Interaction Therapy, PCIT, serve and return, co-regulation, executive function, amygdala/);
    expect(system).toMatch(/'the Two-Choice Rule'\) are fine/);
    expect(system.match(/- Bad: /g)?.length).toBe(2);
    expect(system.match(/ Good: /g)?.length).toBe(2);
    expect(system).toMatch(/never deep or abstract/);
  });

  it("the vetted claims are in plain words: no technique, therapy or study names", async () => {
    const { jargonWord } = await import("@/lib/ai/plain-words");
    const anchorLine = reelScriptPrompt(input10).prompt.split("\n").find((l) => l.includes("ONE soft anchor"))!;
    expect(anchorLine).toMatch(/Facts you may state: /);
    expect(jargonWord(anchorLine.split("Facts you may state: ")[1])).toBeNull();
  });

  it("refuses a Filipino / Tagalog word in a line, the hook card, a label or the title, and retries", () => {
    expect(val(withLine(5, "Your anak is tired, so go slow."))).toEqual({ ok: false, error: 'Line 6 uses a Filipino / Tagalog word ("anak"): write simple English anyone understands.' });
    expect(val(withLine(5, "It works naman, every single night."))).toEqual({ ok: false, error: 'Line 6 uses a Filipino / Tagalog word ("naman"): write simple English anyone understands.' });
    expect(val(script(10, { hook_text: "LOLA SAID… SCIENCE SAYS" }))).toEqual({ ok: false, error: 'The hook card uses a Filipino / Tagalog word ("LOLA"): write simple English anyone understands.' });
    expect(val(script(10, { title: "Merienda time without the fight" }))).toEqual({ ok: false, error: 'The title uses a Filipino / Tagalog word ("Merienda"): write simple English anyone understands.' });
    const s = script(10);
    s.scenes[4] = { ...s.scenes[4], on_screen: "Say: \"Salamat, anak\"" } as never;
    expect(val(s)).toEqual({ ok: false, error: 'Line 5\'s on-screen label uses a Filipino / Tagalog word ("Salamat"): write simple English anyone understands.' });
    // English words are never mistaken for Tagalog ("ate" / "po" are not on the hard list)
    expect(val(withLine(5, "She ate her peas, then asked for salad.")).ok).toBe(true);
    expect(val(withLine(5, "Grandma meant well. Keep the cuddles.")).ok).toBe(true);
  });

  it("refuses jargon (techniques, therapies, brain words) anywhere; plain words and own tip names pass", () => {
    expect(val(withLine(5, "Experts say affect labeling calms them down."))).toEqual({ ok: false, error: 'Line 6 uses expert jargon ("affect labeling"): say it in plain everyday words.' });
    expect(val(withLine(5, "That builds executive function over time."))).toEqual({ ok: false, error: 'Line 6 uses expert jargon ("executive function"): say it in plain everyday words.' });
    expect(val(withLine(5, "It comes from PCIT, a parenting program."))).toEqual({ ok: false, error: 'Line 6 uses expert jargon ("PCIT"): say it in plain everyday words.' });
    expect(val(script(10, { hook_text: "SERVE AND RETURN, EXPLAINED" }))).toEqual({ ok: false, error: 'The hook card uses expert jargon ("SERVE AND RETURN"): say it in plain everyday words.' });
    expect(val(withLine(5, "Child experts say naming the feeling helps kids calm.")).ok).toBe(true);
    expect(val(withLine(5, "That's the Two-Choice Rule. Two options, every time.")).ok).toBe(true);
  });

  it("the writer retries a script with a Tagalog word (the action loop re-asks on any validation error)", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: (() => { const s = script(10); s.scenes[3] = { ...s.scenes[3], narration: 'Say "Ingat, anak" softly.' }; return s; })() });
    const r = await writeReelScript(input10);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Filipino \/ Tagalog word/) });
  });
});
