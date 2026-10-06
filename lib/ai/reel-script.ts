import "server-only";
import { capKeys, emotionOf, fixShots, REEL_EMOTIONS, REEL_SHOTS, type ReelEmotion, type ReelShot } from "@/lib/reels/motion";
import type { ReelCast } from "@/lib/reels/prompt";
import { DEFAULT_THEME_ID, isDollTheme, type ReelTheme } from "@/lib/reels/themes";
import { generateJson, type GeminiSchema } from "./gemini";

/** Same model as the n8n Knitted Doll storyboard. */
export const REEL_SCRIPT_MODEL = "gemini-3.1-pro-preview";
/** Default budget (3.1 Pro took ~40 s in the smoke test); callers pass what is left of their own budget. */
export const REEL_SCRIPT_TIMEOUT_MS = 120_000;
/** Newest titles carried in the "already made" block. */
export const ALREADY_MADE_CAP = 150;
/** Longest spoken line (Chatterbox ~4 words/s, one image per line). */
export const LINE_MAX_WORDS = 14;
export const TITLE_MAX = 80;
/** The opening line is a scroll-stopper spoken in under 2 s: the prompt asks for at most 7 words, 9 are accepted. */
export const HOOK_LINE_MAX_WORDS = 9;
/** Longest body-language note per line. */
export const ACTION_MAX = 200;

export const REEL_STAGES = ["newborn", "baby", "toddler", "preschooler"] as const;
export type ReelStage = (typeof REEL_STAGES)[number];
export interface ReelScriptScene {
  beat: string; narration: string; idea: string;
  /** The line's feeling (one of REEL_EMOTIONS). */
  emotion: ReelEmotion;
  /** Body language + what the hands do ('' when Gemini gave none). */
  action: string;
  /** The framing (one of REEL_SHOTS); never the same on two lines in a row. */
  shot: ReelShot;
  /** One of the (at most 3) key moments: gets the 'punch' emphasis. */
  key: boolean;
}
export interface ReelScript { title: string; stage: ReelStage; cast: ReelCast; scenes: ReelScriptScene[] }
/** An earlier reel, newest first, for the "already made" block. */
export interface MadeReel { title: string; stage?: string | null }
export interface ReelScriptInput {
  topic?: string; maxScenes: number; alreadyMade: MadeReel[]; timeoutMs?: number;
  /** Narration speed (settings.reel_speed, 1.00–1.25; default 1 = unchanged): a faster voice fits more words in the same time. */
  speed?: number;
  /** The reel's visual theme (default knitted): the cast is written as dolls only for Knitted Doll. */
  theme?: Pick<ReelTheme, "id" | "faces">;
}
export type ReelScriptResult = { ok: true; script: ReelScript } | { ok: false; error: string };

const BEATS = ["hook", "build", "turn", "close"];

// Ported from n8n workflow 5RCvIIU6RKC0H8lW "Storyboard Generator" (docs/reference/reel-knitted-doll-n8n.md).
export const REEL_SCRIPT_SYSTEM = [
  "You are a masterful emotional storyteller who makes Filipino moms tear up and immediately SHARE the video with other moms. You write tender, heartfelt, slightly nostalgic reflections about how fast the early years pass — spoken gently, straight to a mom ('you', 'mama'), like a loving lola reminding her to hold on to this fleeting season. Deeply emotional, warm, sincere — NOT advice, NOT a lecture. Every line tugs the heart. Plain English, no emojis, no hashtags.",
  "",
  "HUMAN, NATURAL TONE (very important): Write the way a real, warm person actually TALKS — conversational and natural, never like an AI or a written essay. Use contractions (you're, don't, it's, they'll, here's). Vary sentence length: mix short punchy lines with the occasional slightly longer one so it has a natural spoken rhythm. Sound like a caring, experienced expert talking to a friend over coffee — warm, genuine, a little personality. STRICTLY AVOID AI-sounding tells and clichés: no 'in today's world', 'let's dive in', 'when it comes to', 'simply', 'furthermore', 'moreover', 'it is important to note', stiff parallel/listy phrasing, or formal transitions. No corporate filler, no generic buzzwords. If you read it out loud it should sound like a human said it, not a robot.",
  "",
  "WHO YOU'RE TALKING TO (very important): Your audience is 80% FILIPINO MOMS of babies and toddlers. Write in clean, simple English (easy for Filipinos, still great for global viewers), but frame everything around what a Filipino mom deeply feels — her fierce love for her 'anak', close family, lola/grandparent wisdom, faith and gratitude, doing her best on a budget, and the quiet exhaustion of motherhood. Make her feel SEEN. Never sound foreign, clinical, or preachy.",
  "",
  "AUDIENCE & AGE FOCUS (CRITICAL): This content is ENTIRELY about the EARLY YEARS — newborns (0-3 months), babies/infants (3-12 months), toddlers (1-3 years), and young children (3-5 years). Speak to NEW and young parents. Do NOT make content about tweens or teenagers — never feature a school-age, tween, or teen child.",
].join("\n");

const AUTO_TOPIC = [
  "Topic: (none given) — CHOOSE a fresh, genuinely useful, high-search-intent topic from the REAL early-parenting needs that worried new parents urgently look up. Cover the FULL breadth across the early stages — deliberately VARY the stage and subject every time (newborn vs young baby vs toddler vs preschooler). Examples of the kinds of important topics (pick ONE specific angle, do not list many):",
  "- NEWBORN (0-3 mo): how to safely hold and support a newborn's head and neck, soothing a crying newborn, safe sleep (back to sleep, bare crib), feeding and burping, bathing a slippery newborn, swaddling, umbilical cord care, recognizing real warning signs / when to call the doctor, day-night confusion.",
  "- BABY (3-12 mo): tummy time and motor milestones, starting solids safely, sleep routines, teething comfort, baby-proofing, language and brain development, separation anxiety.",
  "- TODDLER (1-3 yr): handling tantrums calmly, potty training, picky eating, setting limits with love, encouraging talking, screen-time for little ones, building independence.",
  "- PRESCHOOLER (3-5 yr): big emotions and self-regulation, listening without yelling, confidence and resilience, play that builds the brain, getting ready for school.",
  "Think like a real expert chasing reach: choose SPECIFIC, practical, scroll-stopping topics — never vague ones. Make every video feel DIFFERENT — do NOT repeat the same stage, scenario, or angle you would obviously default to.",
].join("\n");

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Spoken-word budget: 330-420 words (~90-120 s at Chatterbox's pace) × the narration speed (the voice is
 * sped up, so more words fit in the same time), shrunk when few images are allowed (lines stay 10-12 words).
 * A script is accepted with at least `minScenes` lines (75% of the max) and `minWords` (80% of `lo`).
 */
export function reelWordBudget(maxScenes: number, speed = 1) {
  const x = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const lo = Math.min(Math.round(330 * x), maxScenes * 10);
  const hi = Math.min(Math.round(420 * x), maxScenes * 12);
  const rate = 3.5 * x;
  return {
    lo, hi, minScenes: Math.min(maxScenes, Math.ceil(0.75 * maxScenes)), minWords: Math.ceil(0.8 * lo),
    secLo: Math.round(lo / rate), secHi: Math.round(hi / rate),
    /** Words per second the prompt quotes (3.5-4 at 1×). */
    wpsLo: Math.round(3.5 * x * 10) / 10, wpsHi: Math.round(4 * x * 10) / 10,
  };
}

/** The cast block: crocheted dolls for Knitted Doll, people for every other theme (the style turns them into clay, paper, …). */
function castRules(dolls: boolean): string {
  return dolls
    ? "- The art is a HANDMADE KNITTED-TEXTILE DOLL style (amigurumi crochet dolls made of soft wool and yarn), so describe the recurring cast AS TEXTILE DOLLS, not as people. Start each description with a short name, then the details — e.g. \"the mom doll: a crocheted mother doll with chunky dark-brown yarn hair gathered in a low bun, warm tan wool skin, a mustard-yellow cable-knit cardigan over a cream knitted dress\" and \"the baby doll: a small crocheted baby doll about six months old with a few soft tufts of dark-brown yarn hair, warm tan wool skin, a rust-orange knitted romper with a round cream collar\". Give exact fixed doll details (approximate age, yarn hair colour and length, build, knitted clothing in warm earthy colours — mustard, cream, rust, oatmeal, sage — and its shapes) so the same two dolls appear in every image."
    : "- The art style is added later by the image system, so describe the recurring cast as REAL PEOPLE with plain, exact details. Start each description with a short name, then the details — e.g. \"the mom: a young Filipino mother in her early thirties with warm tan skin and dark-brown hair gathered in a low bun, wearing a mustard-yellow cardigan over a cream dress\" and \"the baby: a chubby six-month-old baby with warm tan skin and a few soft tufts of dark-brown hair, wearing a rust-orange romper with a round cream collar\". Give exact fixed details (approximate age, hair colour and length, build, clothing in warm earthy colours — mustard, cream, rust, oatmeal, sage — and its shapes) so the same two people appear in every image.";
}

/** Feeling + pose rules: faceless themes (Knitted Doll, Paper Craft) show the feeling through body language only. */
function feelingRule(dolls: boolean, faces: boolean): string {
  if (dolls) return "- The dolls have fixed embroidered faces, so EVERY emotion must show through POSE and HANDS (posture, head tilt, how they hold each other). Keep the dolls grounded and close: sitting, standing, kneeling, lying or cuddling together, the child doll held snugly against the chest or resting in a lap, on a blanket or on the floor. Never have a doll lift, raise, toss or hold the child doll up in the air.";
  if (!faces) return "- The characters have simple fixed faces, so EVERY emotion must show through POSE and HANDS (posture, head tilt, how they hold each other).";
  return "- Faces are expressive in this style: the emotion should be readable on both faces, and the body language should match it.";
}

/** The ported storyboard prompt; `alreadyMade` is newest first. */
export function reelScriptPrompt({ topic, maxScenes, alreadyMade, speed, theme }: ReelScriptInput): { system: string; prompt: string } {
  const t = oneLine(topic ?? "");
  const made = alreadyMade
    .map((m) => ({ title: oneLine(m.title ?? ""), stage: oneLine(m.stage ?? "") }))
    .filter((m) => m.title)
    .slice(0, ALREADY_MADE_CAP);
  const b = reelWordBudget(maxScenes, speed);
  const th = theme ?? { id: DEFAULT_THEME_ID, faces: false };
  const dolls = isDollTheme(th);
  const name = dolls ? "'the mom doll', 'the toddler doll'" : "'the mom', 'the toddler'";
  const who = dolls ? "dolls" : "characters";
  const prompt = [
    t ? `Topic: ${t}` : AUTO_TOPIC,
    "",
    "ALREADY MADE — DO NOT REPEAT: below are titles you have ALREADY produced. Do NOT repeat any of these titles, themes, or the same stage/angle. Deliberately choose a CLEARLY DIFFERENT topic and (when possible) a different early-childhood stage from the recent ones:",
    made.length ? made.map((m) => `- ${m.title}${m.stage ? ` (${m.stage})` : ""}`).join("\n") : "(none yet — this is the first one)",
    "",
    "Write a COHESIVE vertical Reel told with STATIC images (one still image per scene), featuring the SAME recurring parent-and-child characters, that builds ONE continuous emotional wave. Structure (built for SHARES & saves): HOOK — a scroll-stopping gut-punch that opens a tender loop ('You'll carry them for the last time.'); then gently BUILD with small, specific, aching-sweet details of this fleeting stage (the tiny socks, the 3am feeds, the way they reach for you); then TURN to a soft, wise truth that reframes the exhaustion as a gift; then a warm emotional CLOSE giving permission to slow down and hold on + a heartfelt signature tagline. FEEL like a warm hug and flow as ONE story — never a tip list.",
    "",
    "THE AD-STYLE HOOK, MINI-HOOKS AND LOOP (CRITICAL — this must play like an unskippable ad):",
    `- LINE 1 IS A SCROLL-STOPPER spoken in under 2 seconds: at most 7 words (never more than ${HOOK_LINE_MAX_WORDS}). Make it a bold claim ('Your baby remembers more than you think.'), a 'stop doing X' warning ('Stop rushing bedtime, mama.'), or an open question ('Why do babies fight sleep?'). NEVER a greeting (no 'hi', 'hello', 'hey mama', 'welcome'), never an introduction, never the page name.`,
    "- Every 4-6 lines, drop a MINI-HOOK line that re-opens curiosity and pulls them forward ('But here's the part nobody tells you...', 'And the next one surprised me.', 'Wait, it gets better.'). It still counts as a normal 8-12 word line.",
    "- The LAST line LOOPS BACK to the opening: it echoes line 1's words or answers its question, so the video replays seamlessly.",
    "",
    "RETENTION & UNSKIPPABILITY (bake these in): (1) The FIRST image must be visually dramatic — the opening scene's idea is a striking, high-emotion moment, NEVER a calm establishing view. (2) Open a CURIOSITY LOOP in the first lines and only pay it off near the END (tease 'the one thing most parents miss', 'wait for the last one', 'number 3 changed everything'). (3) If you list things, PROMISE the number up front ('here are 3...') and count them out loud so viewers stay for all of them. (4) NO dead weight — every single line must make them need the next one; cut anything skippable. (5) END with a satisfying payoff, then a short, casual call to action to follow the page for more (never salesy), and the loop back to line 1. (6) The very first line is a short, punchy hook. Only the first 1-2 lines are the 'hook' beat; then build, turn and close.",
    "",
    `PACING & COUNT (CRITICAL): Write the COMPLETE narration for a ${b.secLo}-${b.secHi} second video. The voice speaks briskly (about ${b.wpsLo}-${b.wpsHi} words per second), so the narration must be ${b.lo}-${b.hi} words in total. Break it into spoken lines of 8-12 words EACH (only the very first hook line is shorter) — ONE image per line, so cuts stay fast with zero dead space. Never more than ${LINE_MAX_WORDS} words in a line. Write EXACTLY ${b.minScenes}-${maxScenes} scenes — never fewer than ${b.minScenes}, never more than ${maxScenes}. A script under ${b.lo} words is TOO SHORT and will be rejected. BEFORE ANSWERING, COUNT: count your scenes (must be ${b.minScenes}-${maxScenes}), count the words in every line (8-12 each) and add them up (must be ${b.lo}-${b.hi}); if it is short, add more lines to the story until it fits.`,
    "",
    "CRITICAL for visual consistency:",
    "- Define ONE recurring cast that FITS THIS TOPIC — a parent and a YOUNG child of the appropriate stage for the subject (e.g. a mother cradling her newborn, a father holding his baby, a mom and her toddler, a dad and his preschooler). The child MUST be a newborn, baby, toddler, or young child (age 0-5) — NEVER a tween or teenager. Vary the parent (mom or dad) and the child's stage to match the topic.",
    castRules(dolls),
    "",
    "THE IMAGE IDEA for each scene (the art style and the cast details are added later by the image system, so keep the idea plain):",
    `- One or two sentences of plain visual description: who is in frame (by their short names, e.g. ${name}), what they are doing, and where. It must visually MATCH that scene's line and advance the story.`,
    `- Vary the scenes by ACTION and SETTING: different rooms and places (bedroom, kitchen, sala, garden, a jeepney ride, a market, a church, lola's house, a bath, a park) and different activities. Keep the ${who} clearly in view; never rely on extreme close-ups or tiny details filling the frame.`,
    dolls
      ? "- Describe only what IS in the picture (never mention what is absent). Leave out style words (knitted, crochet, yarn, wool, felt, amigurumi, doll materials), lighting, colours of the art style, lenses, picture-taking gear and framing jargon."
      : "- Describe only what IS in the picture (never mention what is absent). Leave out art-style words (materials, drawing or rendering style), lighting, colours of the art style, lenses, picture-taking gear and framing jargon.",
    "- Pictures carry no writing: never ask for signs, labels, books with words, screens with text, letters or numbers.",
    "",
    "EMOTION, ACTION, SHOT AND KEY for each scene (they make every picture feel different):",
    `- "emotion": exactly one of ${REEL_EMOTIONS.join("|")} — the feeling of that moment. Follow the story's wave and VARY it: never the same emotion on more than 2 lines in a row.`,
    "- \"action\": the body language and what the hands do, in one short phrase (e.g. 'kneels and cups the toddler's cheeks in both hands', 'leans back laughing, arms wrapped around the baby'). Describe only what the body IS doing; never mention what is absent.",
    feelingRule(dolls, th.faces),
    `- "shot": exactly one of ${REEL_SHOTS.join("|")}. NEVER the same shot on two lines in a row; mostly medium, wide and eye-level, with low-angle, over-the-shoulder and hands-detail as accents.`,
    "- \"key\": true on AT MOST 3 lines — the biggest emotional turns or payoffs later in the story (they get a punchy zoom; line 1 already has one, so never line 1); false on every other line.",
    "",
    "Return ONLY JSON in EXACTLY this shape:",
    "{",
    '  "title": "<short internal title, at most 60 characters, different from every already-made title>",',
    '  "stage": "<the single early-childhood stage this video targets: exactly one of newborn|baby|toddler|preschooler>",',
    dolls
      ? '  "cast": { "adult": "<the parent doll, exact fixed description>", "child": "<the child doll, exact fixed description>" },'
      : '  "cast": { "adult": "<the parent, exact fixed description>", "child": "<the child, exact fixed description>" },',
    `  "scenes": [ { "beat": "<hook|build|turn|close>", "narration": "<the short spoken line for this scene — natural, second person>", "idea": "<plain visual description of this scene's picture>", "emotion": "<${REEL_EMOTIONS.join("|")}>", "action": "<body language + hands>", "shot": "<${REEL_SHOTS.join("|")}>", "key": <true|false> } ]`,
    "}",
    `The number of scenes follows the script (one image per short line), up to ${maxScenes} scenes.`,
  ].join("\n");
  return { system: REEL_SCRIPT_SYSTEM, prompt };
}

const SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", description: "short internal title, at most 60 characters" },
    stage: { type: "STRING", enum: [...REEL_STAGES] },
    cast: {
      type: "OBJECT",
      properties: { adult: { type: "STRING" }, child: { type: "STRING" } },
      required: ["adult", "child"],
    },
    scenes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          beat: { type: "STRING", enum: BEATS },
          narration: { type: "STRING", description: "one spoken line, 8-12 words" },
          idea: { type: "STRING", description: "plain visual description of the picture" },
          emotion: { type: "STRING", enum: [...REEL_EMOTIONS] },
          action: { type: "STRING", description: "body language + what the hands do, one short phrase" },
          shot: { type: "STRING", enum: [...REEL_SHOTS] },
          key: { type: "BOOLEAN", description: "true on at most 3 lines: the biggest emotional moments" },
        },
        required: ["beat", "narration", "idea", "emotion", "action", "shot", "key"],
      },
    },
  },
  required: ["title", "stage", "cast", "scenes"],
};

const str = (v: unknown) => (typeof v === "string" ? oneLine(v) : "");
const words = (s: string) => s.split(" ").filter(Boolean).length;
// "camera" in an image prompt summons one: the usual "looks at the camera" becomes "toward the viewer".
export const lightClean = (s: string) => s.replace(/\b(?:at|into|towards?) (?:the |a )?camera\b/gi, "toward the viewer");
/** Line 1 must stop the scroll, never greet. */
export const GREETING_RE = /^(?:hi|hello|hey|hiya|welcome|greetings|good (?:morning|afternoon|evening|day)|kumusta|mabuhay)\b/i;

/** Check and normalise Gemini's JSON into a script, or say what is wrong. */
export function validateReelScript(raw: unknown, maxScenes: number, speed = 1): ReelScriptResult {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = str(d.title);
  if (!title) return { ok: false, error: "The script has no title." };
  if (title.length > TITLE_MAX) return { ok: false, error: `The title is longer than ${TITLE_MAX} characters.` };
  const stage = REEL_STAGES.find((x) => x === str(d.stage).toLowerCase());
  if (!stage) return { ok: false, error: "The script has no early-childhood stage." };
  const c = (d.cast && typeof d.cast === "object" ? d.cast : {}) as Record<string, unknown>;
  const cast = { adult: lightClean(str(c.adult)), child: lightClean(str(c.child)) };
  if (!cast.adult || !cast.child) return { ok: false, error: "The script is missing the parent or child doll." };
  const list = Array.isArray(d.scenes) ? d.scenes.slice(0, maxScenes) : [];
  if (list.length < 2) return { ok: false, error: "The script needs at least 2 scenes." };
  const budget = reelWordBudget(maxScenes, speed);
  const scenes: Omit<ReelScriptScene, "shot" | "key">[] = [];
  const raws: Record<string, unknown>[] = [];
  for (const [i, s] of list.entries()) {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const narration = str(o.narration);
    if (!narration) return { ok: false, error: `Line ${i + 1} has no words.` };
    if (words(narration) > LINE_MAX_WORDS) return { ok: false, error: `Line ${i + 1} is longer than ${LINE_MAX_WORDS} words.` };
    const idea = lightClean(str(o.idea));
    if (!idea) return { ok: false, error: `Line ${i + 1} has no image idea.` };
    if (i === 0 && words(narration) > HOOK_LINE_MAX_WORDS) {
      return { ok: false, error: `Line 1 is too long for a hook (${words(narration)} words; at most ${HOOK_LINE_MAX_WORDS}).` };
    }
    if (i === 0 && GREETING_RE.test(narration)) return { ok: false, error: "Line 1 is a greeting, not a hook." };
    const beat = BEATS.includes(str(o.beat)) ? str(o.beat) : "build";
    // A feeling Gemini made up falls back to tender; the body-language note is optional.
    const emotion = emotionOf(o.emotion) ?? "tender";
    const action = lightClean(str(o.action)).slice(0, ACTION_MAX).trim();
    scenes.push({ beat, narration, idea, emotion, action });
    raws.push(o);
  }
  if (scenes.length < budget.minScenes) return { ok: false, error: `Script too short: ${scenes.length} scenes (needs at least ${budget.minScenes}).` };
  const total = scenes.reduce((n, x) => n + words(x.narration), 0);
  if (total < budget.minWords) return { ok: false, error: `Script too short: ${total} words (needs at least ${budget.minWords}).` };
  // Never the same shot twice in a row; at most 3 key lines outside the hook (the first ones marked).
  const shots = fixShots(raws.map((o) => o.shot));
  const keys = capKeys(raws.map((o, i) => ({ beat: scenes[i].beat, key: o.key === true })));   // hook lines punch anyway
  return { ok: true, script: { title, stage, cast, scenes: scenes.map((x, i) => ({ ...x, shot: shots[i], key: keys[i] })) } };
}

/** Write a reel script with Gemini. Never throws. */
export async function writeReelScript(input: ReelScriptInput): Promise<ReelScriptResult> {
  try {
    const { system, prompt } = reelScriptPrompt(input);
    const r = await generateJson<Record<string, unknown>>({
      system, prompt, schema: SCHEMA, model: REEL_SCRIPT_MODEL, thinkingLevel: "low", temperature: 1,
      timeoutMs: input.timeoutMs ?? REEL_SCRIPT_TIMEOUT_MS,
      parse: (x) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null),
    });
    if (!r.ok) return { ok: false, error: r.error };
    return validateReelScript(r.data, input.maxScenes, input.speed);
  } catch (e) {
    return { ok: false, error: `Could not write the script (${e instanceof Error ? e.message.slice(0, 120) : "unknown error"}).` };
  }
}
