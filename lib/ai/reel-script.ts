import "server-only";
import { emotionOf, REEL_EMOTIONS, type ReelEmotion } from "@/lib/reels/motion";
import { childAge, joinIdea, type ReelCast } from "@/lib/reels/prompt";
import { cleanFeeling, cleanScene, FEELING_FOR_EMOTION, isGuideThemeId, REEL_THREADS, threadFor, type ReelThread } from "@/lib/reels/guide";
import {
  capPunches, PUNCH_MAX, PUNCH_MAX_WORDS, punchIn, REEL_SHOT_SIZES, REEL_SUBJECTS, repairShotList,
  type ReelShotSize, type ReelSubject,
} from "@/lib/reels/shots";
import { DEFAULT_THEME_ID, isDollTheme, type ReelTheme } from "@/lib/reels/themes";
import { generateJson, type GeminiSchema } from "./gemini";

/** Same model as the n8n Knitted Doll storyboard. */
export const REEL_SCRIPT_MODEL = "gemini-3.1-pro-preview";
/** Default budget (3.1 Pro took ~40 s in the smoke test); callers pass what is left of their own budget. */
export const REEL_SCRIPT_TIMEOUT_MS = 120_000;
/** Newest titles carried in the "already made" block. */
export const ALREADY_MADE_CAP = 150;
/** Longest spoken line (playbook: sentences 4-12 words, max 15; one image per line). */
export const LINE_MAX_WORDS = 15;
export const TITLE_MAX = 80;
/** Line 1 is spoken by 0.5 s and carries the hook: at most 12 words (the prompt asks for 6-10). */
export const HOOK_LINE_MAX_WORDS = 12;
/** The hook card on screen over the first 3.5 s. */
export const HOOK_TEXT_MAX_WORDS = 10;
export const HOOK_TEXT_MAX = 80;
/** Longest body-language note per line. */
export const ACTION_MAX = 200;
/** Longest setting per line (place + time of day). */
export const SETTING_MAX = 120;
/** Longest short character tag. */
export const TAG_MAX = 100;
/** Reel length (playbook default 45-75 s; never under 15 s) and the narrator's pace at 1×. */
export const REEL_SECONDS = { lo: 45, hi: 75, floor: 15 } as const;
export const WORDS_PER_SECOND = 3.8;

export const REEL_STAGES = ["newborn", "baby", "toddler", "preschooler"] as const;
export type ReelStage = (typeof REEL_STAGES)[number];
export interface ReelScriptScene {
  beat: string; narration: string;
  /** The picture: the moment, then " — " and its setting (place + time of day). */
  idea: string;
  /** The line's feeling (one of REEL_EMOTIONS). */
  emotion: ReelEmotion;
  /** Body language + what the hands do ('' when Gemini gave none). */
  action: string;
  /** Shot size + who is in frame, after the shot-list repair (lib/reels/shots). */
  shot_size: ReelShotSize; subject: ReelSubject;
  /** A stressed word / short phrase of the narration (verbatim) for a punch-in; null = none (at most 4 per reel). */
  punch: string | null;
  /** A time jump before this line (never line 1). */
  time_jump: boolean;
  /** Crayon / Red Thread (012): the picture's "The feeling is …" phrase; null for the older themes. */
  feeling?: string | null;
  /** Red Thread (012): the thread's state in this picture; null for every other theme. */
  thread?: ReelThread | null;
}
export interface ReelScript {
  title: string; stage: ReelStage; cast: ReelCast;
  /** The hook card (≤ 10 words) that complements line 1. */
  hook_text: string;
  scenes: ReelScriptScene[];
}
/** An earlier reel, newest first, for the "already made" block. */
export interface MadeReel { title: string; stage?: string | null }
export interface ReelScriptInput {
  topic?: string; maxScenes: number; alreadyMade: MadeReel[]; timeoutMs?: number;
  /** Narration speed (settings.reel_speed, 1.00–1.25; default 1 = unchanged): a faster voice fits more words in the same time. */
  speed?: number;
  /** The reel's visual theme (default Crayon): the cast is written as dolls only for Knitted Doll; Crayon and Red
   *  Thread get each line's picture written to the owner's style guide. */
  theme?: Pick<ReelTheme, "id" | "faces">;
}
export type ReelScriptResult = { ok: true; script: ReelScript } | { ok: false; error: string };

const BEATS = ["hook", "build", "turn", "close"];

export const REEL_SCRIPT_SYSTEM = [
  "You are a masterful short-form storyteller for a Facebook page whose audience is mostly Filipino moms of babies and toddlers. You write narrated vertical reels that people watch to the very end: tender, specific, a little nostalgic, spoken straight to a mom ('you', 'mama') like a warm friend who has been there. Deeply felt, never a lecture. Plain English, no emojis, no hashtags.",
  "",
  "HUMAN, NATURAL TONE (very important): Write the way a real, warm person actually TALKS. Use contractions (you're, don't, it's). Short spoken sentences, present tense, concrete nouns (tiny socks, the 3 a.m. bottle, the creak of the crib) over abstractions. Validate the parent, never shame her. STRICTLY AVOID AI-sounding tells and clichés: no 'in today's world', 'let's dive in', 'when it comes to', 'simply', 'furthermore', 'moreover', 'journey', 'it is important to note', stiff listy phrasing or formal transitions.",
  "",
  "WHO YOU'RE TALKING TO: Filipino moms (clean, simple English that is great for global viewers too). Frame everything around what she deeply feels — her fierce love for her 'anak', close family, lola wisdom, faith and gratitude, doing her best on a budget, the quiet exhaustion of motherhood. Use local detail where it fits (the sala, a jeepney ride, lola's house, the palengke, merienda, rice on the stove). Make her feel SEEN.",
  "",
  "AGE FOCUS (CRITICAL): ONLY the early years — newborns (0-3 months), babies (3-12 months), toddlers (1-3 years) and young children (3-5 years). Never a tween or teenager.",
].join("\n");

const AUTO_TOPIC = [
  "Topic: (none given) — CHOOSE one fresh, specific, high-emotion or high-search-intent topic from the real early-parenting life of a new mom. Deliberately VARY the stage and subject every time (newborn vs baby vs toddler vs preschooler). Examples of the KIND of angle (pick ONE, do not list many):",
  "- NEWBORN (0-3 mo): the first night home, soothing a newborn who won't stop crying, the 3 a.m. feeds, the first bath, safe sleep, day-night confusion, the warning signs that need a doctor.",
  "- BABY (3-12 mo): the first real laugh, teething nights, starting solids, separation anxiety, the first crawl, going back to work.",
  "- TODDLER (1-3 yr): a tantrum in public, potty training, picky eating, the first 'I love you', 'I do it myself', bedtime battles.",
  "- PRESCHOOLER (3-5 yr): big feelings, the first day of school, the endless 'why?', the last time they ask to be carried.",
  "Never a vague topic. Make every reel feel DIFFERENT from the already-made ones.",
].join("\n");

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Spoken-word budget for a 45-75 s reel: seconds × 3.8 words/s × the narration speed (a sped-up voice fits more words),
 * shrunk when few images are allowed (7-10 words a line) but never under 18 s of speech. A script is accepted with at
 * least `minScenes` lines and `minWords` words (80 % of `lo`, never under 15 s).
 */
export function reelWordBudget(maxScenes: number, speed = 1) {
  const x = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const rate = WORDS_PER_SECOND * x;
  const lo = Math.max(Math.ceil(rate * 18), Math.min(Math.round(rate * REEL_SECONDS.lo), maxScenes * 7));
  const hi = Math.max(lo, Math.min(Math.round(rate * REEL_SECONDS.hi), maxScenes * 10));
  return {
    lo, hi,
    minScenes: Math.min(maxScenes, Math.max(2, Math.ceil(lo / 10))),
    minWords: Math.max(Math.ceil(0.8 * lo), Math.ceil(rate * REEL_SECONDS.floor)),
    secLo: Math.round(lo / rate), secHi: Math.round(hi / rate),
    /** Words per second the prompt quotes. */
    wps: Math.round(rate * 10) / 10,
  };
}

/** Red Thread is black-and-white line art: the cast is described without colours so it stays the same in grey. */
const GREY_CAST_RULE = "- RED THREAD STYLE: the pictures are black-and-white line art where only the red thread has colour, so describe hair and clothes by shape and pattern ONLY, with NO colour words at all (e.g. 'a plain long-sleeved blouse and a long skirt', 'a striped romper') and never anything red.";

/** The cast block: crocheted dolls for Knitted Doll, people for every other theme (the style turns them into clay, paper, …). */
function castRules(dolls: boolean): string {
  return dolls
    ? "- The art is a HANDMADE KNITTED-TEXTILE DOLL style (amigurumi crochet dolls of soft wool and yarn), so describe the recurring cast AS TEXTILE DOLLS. \"adult\" / \"child\": a short name, then exact fixed details — e.g. \"the mom doll: a crocheted mother doll with chunky dark-brown yarn hair in a low bun, warm tan wool skin, a mustard-yellow cable-knit cardigan over a cream knitted dress\". \"adult_tag\" / \"child_tag\": the SAME doll in at most 7 words, in the form '<who>, <skin> skin, <hair>, <outfit>' — e.g. \"mom doll, tan wool skin, yarn bun, mustard cardigan\" and \"baby doll, tan wool skin, rust romper\". \"child_age\": the child's exact age + noun, fixed for the whole reel (e.g. \"a 10-month-old baby boy\")."
    : "- The art style is added later, so describe the recurring cast as REAL PEOPLE. \"adult\" / \"child\": a short name, then exact fixed details — e.g. \"the mom: a young Filipino mother in her early thirties with warm tan skin and dark-brown hair in a low bun, wearing a mustard-yellow cardigan over a cream dress\". \"adult_tag\" / \"child_tag\": the SAME person in at most 7 words, in the form '<who>, <skin> skin, <hair>, <outfit>' — e.g. \"Filipino mom, tan skin, low bun, mustard cardigan\" and \"chubby baby, tan skin, rust romper\". \"child_age\": the child's exact age + noun, fixed for the whole reel and matching the stage (e.g. \"a 10-month-old baby boy\", \"a 2-year-old toddler girl\"). Clothing in warm earthy colours (mustard, cream, rust, oatmeal, sage) so the same two people appear in every image.";
}

/** Feeling + pose rules: faceless themes (Knitted Doll, Paper Craft) show the feeling through body language only. */
function feelingRule(dolls: boolean, faces: boolean): string {
  if (dolls) return "- The dolls have fixed embroidered faces, so EVERY emotion must show through POSE and HANDS (posture, head tilt, how they hold each other). Keep the dolls grounded and close: sitting, standing, kneeling, lying or cuddling together, the child doll held snugly against the chest or resting in a lap, on a blanket or on the floor. Never have a doll lift, raise, toss or hold the child doll up in the air.";
  if (!faces) return "- The characters have simple fixed faces, so EVERY emotion must show through POSE and HANDS (posture, head tilt, how they hold each other).";
  return "- Faces are expressive in this style: the emotion should be readable on the faces, and the body language should match it.";
}

/** Crayon: what the style wants from the story (owner guide: big emotions, a gesture between the characters). */
const CRAYON_STORY = "THIS STYLE (the owner's Crayon guide): every picture is a rough wax crayon drawing with BIG, warm, exaggerated feelings on the faces. Choose moments where the feeling shows clearly (laughing together, happy tears, comfort after a long day, first steps, a hug that fixes everything).";
/** Red Thread: the page's trademark, and the stories it suits (connection and distance; OFW parents are close to home). */
const RED_THREAD_STORY = "THIS STYLE (the owner's Red Thread guide): every picture is black-and-white storybook line art where ONE bright red thread ties the parent's wrist to the child's wrist — the page's trademark, in every picture. Stories where connection and distance matter are especially welcome: an OFW parent working abroad and the child waiting at home, the first day apart, a reunion at the airport, a small fight that cannot break the bond, a hard season the bond survives. The bond holds in every picture; the thread itself is drawn automatically.";

/**
 * Crayon / Red Thread: each line's [SCENE] is written to the owner's guide (the art style, the shot, the cast sentence,
 * the thread line and "The feeling is …" are added by lib/reels/guide).
 */
function guidePictureRules(red: boolean): string[] {
  const who = "who is in it, by their short names ('the mother' or 'the father', 'the baby', 'the boy' or 'the girl')";
  return [
    `EACH LINE'S PICTURE — written to the owner's ${red ? "Red Thread" : "Crayon"} style guide (the art style, the shot framing, the cast's looks${red ? ", the red thread" : ""} and the closing 'The feeling is …' sentence are added later by the image system):`,
    red
      ? `- "scene": the picture in 1-2 plain sentences (20-45 words) that MATCH the line and move the story: ${who}, the action, their facial expressions and gestures, plus simple furniture or plain everyday objects (a small table, a bed, a suitcase, a cup of tea, a phone held to the chest). Keep the background simple. Keep the wrists in view: a hand rests free, reaches out or holds the other's hand, and a held toy never covers the wrist (the thread is tied there). NO colour words at all (the picture is black-and-white), and never mention the thread (it is drawn from "thread"). A one-person picture: that person alone with what they hold or look at. An object / none picture: one plain object or an empty place.`
      : `- "scene": the picture in 2-3 plain sentences (25-60 words) that MATCH the line and move the story: ${who} and what they are doing together, with BIG, exaggerated facial expressions (eyes crinkled shut from smiling, an open-mouth laugh, tears streaming, bright rosy scribbled cheeks, big glossy eyes) and exactly ONE gesture between the characters (a hug, a hand reaching, a head on a shoulder, holding hands). When two characters are in the picture they look at EACH OTHER. Then name a few foreground objects (toys, flowers, cups, a blanket) and a simple background (a window, the sky, a room): that is where the place and the time of day go. A one-person picture: that person, their big expression and what they hold or reach for; they look at something IN the picture, never looking off-screen (an off-screen look makes the drawing add a stranger). An object / none picture: only the objects and the simple background.`,
    "- In \"scene\" leave out framing words (close-up, wide shot, view), art-style words, lighting and lenses. Describe only what IS in the picture (never what is absent). Pictures carry no writing: never signs, labels, books with words, screens with text, letters or numbers. The last line's scene happens in the SAME place as line 1's.",
    "- \"feeling\": the picture's feeling in 2-8 words that complete 'The feeling is …' (e.g. 'pure love and warmth', 'comfort after a long day', 'missing someone you love', 'letting go while still holding on'). Fresh words per line; never the narration.",
    ...(red ? [`- "thread": the red thread between the parent's and the child's wrists in this picture, exactly one of ${REEL_THREADS.join("|")}: tight = closeness, a hug; stretched = distance (an OFW parent abroad, leaving for work, the first day apart); tangled = a conflict or a misunderstanding; loose = hard times, the bond still holds; plain = an ordinary tender moment.`] : []),
    "- PEOPLE, NOT DOLLS: write every scene and cast line with real people and real things.",
  ];
}

/** The storyboard prompt (playbook v2: hook, re-hooks, arc, loop + a varied shot list); `alreadyMade` is newest first. */
export function reelScriptPrompt({ topic, maxScenes, alreadyMade, speed, theme }: ReelScriptInput): { system: string; prompt: string } {
  const t = oneLine(topic ?? "");
  const made = alreadyMade
    .map((m) => ({ title: oneLine(m.title ?? ""), stage: oneLine(m.stage ?? "") }))
    .filter((m) => m.title)
    .slice(0, ALREADY_MADE_CAP);
  const b = reelWordBudget(maxScenes, speed);
  const th = theme ?? { id: DEFAULT_THEME_ID, faces: true };
  const dolls = isDollTheme(th);
  const guide = isGuideThemeId(th.id);
  const red = th.id === "redthread";
  const name = dolls ? "'the mom doll', 'the baby doll'" : "'the mom', 'the baby'";
  const prompt = [
    t ? `Topic: ${t}` : AUTO_TOPIC,
    "",
    "ALREADY MADE — DO NOT REPEAT: titles you have ALREADY produced. Do NOT repeat any of these titles, situations, or the same stage/angle; choose a CLEARLY DIFFERENT story and (when possible) a different stage from the recent ones:",
    made.length ? made.map((m) => `- ${m.title}${m.stage ? ` (${m.stage})` : ""}`).join("\n") : "(none yet — this is the first one)",
    "",
    "Write ONE short STORY told as a narrated vertical reel of still images (one image per spoken line) with the SAME parent and child throughout: a specific situation that moves forward — a beginning, a turn, an ending — never a list of tips, never the same moment repeated. ONE core idea per reel.",
    "",
    "THE SCRIPT (CRITICAL — this must play like an unskippable reel):",
    `- LINE 1 is the hook, spoken in the first half-second: at most ${HOOK_LINE_MAX_WORDS} words (aim for 6-10). It carries TENSION, a TIME-JUMP, 'you', or a SPECIFIC SURPRISING DETAIL. Pick one: a last-time time-jump ('One day you'll put them down and never pick them up again.'), 'Nobody tells you…', a pain question ('Why does 3 a.m. feel this long?'), a myth-bust, a number + promise, in the middle of the action ('She was crying before I even opened my eyes.'), or a POV identity line ('POV: you haven't sat down since 6 a.m.'). These are PATTERNS only: write fresh words for THIS story and never reuse an example sentence from this brief.`,
    "- BANNED openers: any greeting ('Hi/Hey mga mommies', 'Hello', 'Welcome back'), 'Today I want to talk about', 'In this video', 'Let me tell you', the page or brand name, and backstory first. Start in the middle of the feeling.",
    "- STAKES within the first ~5 seconds (by line 2-3): why this moment matters or what she is about to lose / learn.",
    "- A RE-HOOK every 10-15 seconds (about every 4-5 lines): a 'but…' / 'then…' / 'and that's when…' line that turns the story and pulls them forward.",
    "- Sentences of 4-12 words (never more than 15), one clause per line, and a 2-3-word punch line at least every ~20 seconds ('Every. Single. Night.').",
    "- At least ONE identity line that makes a mom say 'that's me' ('For the mom who eats her rice cold every night.').",
    "- The EMOTIONAL TURN lands at 70-80% of the reel; the last ~20% lands on warmth, awe, gratitude or resolve — never pure sadness.",
    "- The LAST line is the payoff in at most 10 words and loops back to line 1 (echo its words or answer it) so the reel replays seamlessly.",
    "- NEVER ask viewers to follow, like, comment, tag, share or save; no outro, no call to action, no page name.",
    "",
    `LENGTH (CRITICAL): narration for a ${b.secLo}-${b.secHi} second reel at about ${b.wps} words per second = ${b.lo}-${b.hi} words in total, as ${b.minScenes}-${maxScenes} lines (never fewer than ${b.minScenes}, never more than ${maxScenes}). Every line is one image on screen for about 1.5-3.5 seconds. A script under ${b.lo} words is TOO SHORT and will be rejected. BEFORE ANSWERING, COUNT the lines and the words.`,
    "",
    `THE HOOK CARD: "hook_text" is the big title shown on screen over the first 3.5 seconds: at most ${HOOK_TEXT_MAX_WORDS} words, it COMPLEMENTS line 1 (adds the stakes or the twist) and never repeats it word for word (pattern: line 1 states the moment, the card names what is at stake or the twist). Fresh words for this story, never an example sentence from this brief. Keep it short and big on screen: ideally at most 8 words and 45 characters.`,
    "",
    ...(guide ? [red ? RED_THREAD_STORY : CRAYON_STORY, ""] : []),
    "THE CAST:",
    "- ONE recurring parent (mom or dad) and ONE young child of the stage that fits the topic (age 0-5 only).",
    castRules(dolls),
    ...(red ? [GREY_CAST_RULE] : []),
    "",
    "THE SHOT LIST (CRITICAL — the owner's #1 complaint was nine pictures of 'mom holding baby'; every picture must be a DIFFERENT shot that moves the story):",
    `- "shot_size": exactly one of ${REEL_SHOT_SIZES.join("|")}. Per 10 lines aim for about 2 wide, 3 medium, 2 close, 2 detail (an insert of hands, a small object, a texture) and 1 pov (through the mom's own eyes) or broll (a quiet cutaway of the place or an object, nobody in it).`,
    `- "subject": who is in the picture, exactly one of ${REEL_SUBJECTS.join("|")} — mom = the parent alone, baby = the child alone, both = the two together, object = a thing with nobody in it (tiny socks, a cold cup of coffee, the baby monitor glow), none = an empty place. Use 'both' on at most 4 lines in 10, and show no face (object, none, or a detail of hands) on at least 1 line in every 4.`,
    "- LINE 1 shows a FACE (mom, baby or both) in a close or medium shot — a striking, readable moment, never a calm establishing view. Line 2 or 3 is the establishing WIDE (the whole place).",
    "- Never the same shot_size with the same subject on two lines in a row; never more than 2 face shots in a row.",
    "- The LAST line mirrors line 1: the same subject, the same setting and a similar framing, so the reel loops.",
    ...(guide ? [red
      ? "- In this style the thread on the wrist must stay in view: face-free lines are very close detail views of the hands and wrists (subject mom, baby or both with shot_size detail); use subject object or none on at most 1 line."
      : "- In this style every picture of a person shows their face with a BIG, exaggerated expression (the guide's rule; a calm hands-only close-up comes out looking like a photo), so a detail line shows their hands doing something that matters AND their big expression. The face-free line is an object picture: subject object (a few named things on a simple background) on at most 1 line; the other face-free lines are those detail views."] : []),
    "",
    ...(guide ? guidePictureRules(red) : [
    "EACH LINE'S PICTURE (the art style and the cast details are added later by the image system, so keep it plain):",
    `- "idea": what is in the picture — who (by their short names, e.g. ${name}) is doing what, or which object is shown — in one plain sentence that MATCHES the line and advances the story. Leave out the place (that goes in "setting"), art-style words, lighting, colours, lenses and framing jargon. Describe only what IS in the picture (never what is absent). Pictures carry no writing: never signs, labels, books with words, screens with text, letters or numbers.`,
    ...(dolls ? [] : ["- PEOPLE, NOT DOLLS: this theme draws real people, so write every idea, action and cast line with people and real things — never doll, yarn, crochet, knitted, felt or wool wording for bodies or toys (say 'tiny feet', 'toy blocks')."]),
    "- \"setting\": the place + time of day in at most 8 words ('the dim nursery at 3 a.m.', 'the sala on a rainy afternoon', 'a jeepney at dusk'). The story can move between a few places; the last line uses the SAME setting as line 1.",
    "- \"action\": the body language and what the hands do, in one short phrase ('kneels and cups the toddler's cheeks in both hands'); '' for object / none shots. Describe only what the body IS doing.",
    feelingRule(dolls, th.faces),
    ]),
    `- "emotion": exactly one of ${REEL_EMOTIONS.join("|")}. Follow the story's wave; never the same emotion on more than 2 lines in a row.`,
    `- "punch": the ONE stressed word or short phrase (at most ${PUNCH_MAX_WORDS} words, copied EXACTLY from that line's narration) that hits hardest, on at most ${PUNCH_MAX} lines in the whole reel (2-4 of the biggest beats, one of them at the emotional turn); "" on every other line.`,
    "- \"time_jump\": true only on a line that jumps forward or back in time ('Years later…', 'Tomorrow she'll be three.'); false otherwise and always false on line 1.",
    "",
    "Return ONLY JSON in EXACTLY this shape:",
    "{",
    '  "title": "<short internal title, at most 60 characters, different from every already-made title>",',
    '  "stage": "<exactly one of newborn|baby|toddler|preschooler>",',
    `  "hook_text": "<the hook card, at most ${HOOK_TEXT_MAX_WORDS} words>",`,
    '  "cast": { "adult": "<exact fixed description>", "child": "<exact fixed description>", "adult_tag": "<at most 7 words>", "child_tag": "<at most 7 words>", "child_age": "<e.g. a 10-month-old baby boy>" },',
    guide
      ? `  "scenes": [ { "beat": "<hook|build|turn|close>", "narration": "<the spoken line>", "scene": "<the picture, written to the style guide>", "feeling": "<completes 'The feeling is …'>", ${red ? `"thread": "<${REEL_THREADS.join("|")}>", ` : ""}"shot_size": "<${REEL_SHOT_SIZES.join("|")}>", "subject": "<${REEL_SUBJECTS.join("|")}>", "emotion": "<${REEL_EMOTIONS.join("|")}>", "punch": "<word(s) from the line, or empty>", "time_jump": <true|false> } ]`
      : `  "scenes": [ { "beat": "<hook|build|turn|close>", "narration": "<the spoken line>", "idea": "<what is in the picture>", "setting": "<place + time of day>", "shot_size": "<${REEL_SHOT_SIZES.join("|")}>", "subject": "<${REEL_SUBJECTS.join("|")}>", "emotion": "<${REEL_EMOTIONS.join("|")}>", "action": "<body language + hands>", "punch": "<word(s) from the line, or empty>", "time_jump": <true|false> } ]`,
    "}",
  ].join("\n");
  return { system: REEL_SCRIPT_SYSTEM, prompt };
}

const SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", description: "short internal title, at most 60 characters" },
    stage: { type: "STRING", enum: [...REEL_STAGES] },
    hook_text: { type: "STRING", description: `the on-screen hook card, at most ${HOOK_TEXT_MAX_WORDS} words, complementing line 1` },
    cast: {
      type: "OBJECT",
      properties: { adult: { type: "STRING" }, child: { type: "STRING" }, adult_tag: { type: "STRING" }, child_tag: { type: "STRING" }, child_age: { type: "STRING" } },
      required: ["adult", "child", "adult_tag", "child_tag", "child_age"],
    },
    scenes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          beat: { type: "STRING", enum: BEATS },
          narration: { type: "STRING", description: "one spoken line, 4-12 words (max 15)" },
          idea: { type: "STRING", description: "what is in the picture, without the place" },
          setting: { type: "STRING", description: "place + time of day, at most 8 words" },
          shot_size: { type: "STRING", enum: [...REEL_SHOT_SIZES] },
          subject: { type: "STRING", enum: [...REEL_SUBJECTS] },
          emotion: { type: "STRING", enum: [...REEL_EMOTIONS] },
          action: { type: "STRING", description: "body language + what the hands do, one short phrase" },
          punch: { type: "STRING", description: "a stressed word or short phrase copied from the narration, or empty" },
          time_jump: { type: "BOOLEAN" },
        },
        required: ["beat", "narration", "idea", "setting", "shot_size", "subject", "emotion", "action", "punch", "time_jump"],
      },
    },
  },
  required: ["title", "stage", "hook_text", "cast", "scenes"],
};

/** Crayon / Red Thread: each line carries its [SCENE] + feeling (+ the thread) instead of idea / setting / action. */
export function schemaFor(themeId?: string | null): GeminiSchema {
  if (!isGuideThemeId(themeId)) return SCHEMA;
  const red = themeId === "redthread";
  const base = SCHEMA.properties!.scenes.items!;
  const drop = ["idea", "setting", "action"];
  const keep = Object.fromEntries(Object.entries(base.properties!).filter(([k]) => !drop.includes(k)));
  const properties: Record<string, GeminiSchema> = {
    ...keep,
    scene: { type: "STRING", description: "the picture, written to the owner's style guide" },
    feeling: { type: "STRING", description: "2-8 words completing 'The feeling is …'" },
    ...(red ? { thread: { type: "STRING", enum: [...REEL_THREADS] } } : {}),
  };
  const required = [...base.required!.filter((k) => !drop.includes(k)), "scene", "feeling", ...(red ? ["thread"] : [])];
  return { ...SCHEMA, properties: { ...SCHEMA.properties!, scenes: { type: "ARRAY", items: { type: "OBJECT", properties, required } } } };
}

const str = (v: unknown) => (typeof v === "string" ? oneLine(v) : "");
const words = (s: string) => s.split(" ").filter(Boolean).length;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// "camera" in an image prompt summons one: the usual "looks at the camera" becomes "toward the viewer".
export const lightClean = (s: string) => s.replace(/\b(?:at|into|towards?) (?:the |a )?camera\b/gi, "toward the viewer");
/** Line 1 (and the hook card) must stop the scroll: no greeting, intro or page name. */
export const GREETING_RE = /^(?:hi|hello|hey|hiya|welcome|greetings|good (?:morning|afternoon|evening|day)|kumusta|mabuhay|today (?:i|we)(?:'m| am| want| will|'ll)?|in (?:this|today's) (?:video|reel)|let me tell you|so,? today|unique names)\b/i;
/** A spoken call to action (the playbook bans them: no follow / comment / tag / share / save / subscribe). */
export const CTA_RE = /\b(?:follow (?:me|us|the page|this page|for more|along)|comment (?:below|down|if|your)|tag (?:a|your|someone|every|another)|share (?:this|it) (?:with|to)|save this|like and|hit (?:the )?(?:like|follow|share)|link in (?:the )?bio|subscribe)\b/i;

const PLACE = /\b(?:bed|beds|crib|cot|sala|living room|kitchen|room|bedroom|nursery|bathroom|bath|tub|garden|yard|park|street|sidewalk|road|jeepney|tricycle|car|bus|church|market|palengke|store|school|hospital|clinic|house|home|porch|doorway|door|stairs|window|sofa|couch|table|floor|mat|hammock|beach|lola's|veranda|balcony)\b/i;
/** The idea already names a place of its own ("sets Leo down onto his bed"): its setting is not replaced. */
export const namesPlace = (idea: string) => PLACE.test(idea);

/** A guide scene is the stored picture idea: whole sentences, at most this many characters (the review page's limit is 600). */
export const SCENE_MAX = 560;
/** Whole sentences of `s` within `max` characters (the first sentence cut at a word when it alone is longer). */
export function sentencesWithin(s: string, max: number): string {
  if (s.length <= max) return s;
  const parts = s.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const p of parts) {
    if ((out ? out.length + 1 : 0) + p.length > max) break;
    out = out ? `${out} ${p}` : p;
  }
  return out || `${s.slice(0, max).replace(/\s+\S*$/, "").replace(/[\s,;]+$/, "")}.`;
}

/**
 * Check and normalise Gemini's JSON into a script (shot list repaired), or say what is wrong. `themeId` = the reel's
 * theme: Crayon and Red Thread lines carry a guide [SCENE] (stored as the idea), a feeling and (Red Thread) a thread.
 */
export function validateReelScript(raw: unknown, maxScenes: number, speed = 1, themeId?: string | null): ReelScriptResult {
  const guide = isGuideThemeId(themeId);
  const red = themeId === "redthread";
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = str(d.title);
  if (!title) return { ok: false, error: "The script has no title." };
  if (title.length > TITLE_MAX) return { ok: false, error: `The title is longer than ${TITLE_MAX} characters.` };
  const stage = REEL_STAGES.find((x) => x === str(d.stage).toLowerCase());
  if (!stage) return { ok: false, error: "The script has no early-childhood stage." };
  const c = (d.cast && typeof d.cast === "object" ? d.cast : {}) as Record<string, unknown>;
  const cast: ReelCast = { adult: lightClean(str(c.adult)), child: lightClean(str(c.child)) };
  if (!cast.adult || !cast.child) return { ok: false, error: "The script is missing the parent or child doll." };
  // the short tags are optional: the prompt builder cuts one from the description when they are missing
  for (const k of ["adult_tag", "child_tag", "child_age"] as const) {
    const tag = lightClean(str(c[k])).slice(0, TAG_MAX).trim();
    if (tag) cast[k] = tag;
  }
  // the child's age is pinned on every reel (from the description or the stage when Gemini gave none)
  const age = childAge(cast, stage);
  if (age) cast.child_age = age;
  const list = Array.isArray(d.scenes) ? d.scenes.slice(0, maxScenes) : [];
  if (list.length < 2) return { ok: false, error: "The script needs at least 2 scenes." };
  const budget = reelWordBudget(maxScenes, speed);
  const lines: {
    beat: string; narration: string; idea: string; setting: string; emotion: ReelEmotion; action: string;
    feeling: string | null; thread: ReelThread | null;
  }[] = [];
  const raws: Record<string, unknown>[] = [];
  for (const [i, s] of list.entries()) {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const narration = str(o.narration);
    if (!narration) return { ok: false, error: `Line ${i + 1} has no words.` };
    if (words(narration) > LINE_MAX_WORDS) return { ok: false, error: `Line ${i + 1} is longer than ${LINE_MAX_WORDS} words.` };
    if (CTA_RE.test(narration)) return { ok: false, error: `Line ${i + 1} asks viewers to follow, comment, tag or share.` };
    // A feeling Gemini made up falls back to tender; the body-language note and the setting are optional.
    const emotion = emotionOf(o.emotion) ?? "tender";
    // Crayon / Red Thread: the guide [SCENE] is the idea (framing words, the feeling sentence, viewer looks, absent
    // things, camera / lens words and, for Red Thread, the thread and every red colour cleaned out).
    const scene = guide ? cleanScene(o.scene, { red, both: str(o.subject).toLowerCase() === "both" }) : null;
    const idea = scene ? sentencesWithin(scene.scene, SCENE_MAX) : lightClean(str(o.idea)).replace(/\s+—\s+/g, ", ");
    if (!idea) return { ok: false, error: `Line ${i + 1} has no ${guide ? "picture scene" : "image idea"}.` };
    if (i === 0 && words(narration) > HOOK_LINE_MAX_WORDS) {
      return { ok: false, error: `Line 1 is too long for a hook (${words(narration)} words; at most ${HOOK_LINE_MAX_WORDS}).` };
    }
    if (i === 0 && GREETING_RE.test(narration)) return { ok: false, error: "Line 1 is a greeting, not a hook." };
    const beat = BEATS.includes(str(o.beat)) ? str(o.beat) : "build";
    const action = guide ? "" : lightClean(str(o.action)).slice(0, ACTION_MAX).trim();
    const setting = guide ? "" : lightClean(str(o.setting)).replace(/\s+—\s+/g, ", ").slice(0, SETTING_MAX).trim();
    const feeling = guide ? (cleanFeeling(o.feeling) || scene!.feeling || FEELING_FOR_EMOTION[emotion]) : null;
    const thread = red ? threadFor(o.thread, emotion) : null;
    lines.push({ beat, narration, idea, setting, emotion, action, feeling, thread });
    raws.push(o);
  }
  if (lines.length < budget.minScenes) return { ok: false, error: `Script too short: ${lines.length} scenes (needs at least ${budget.minScenes}).` };
  const total = lines.reduce((n, x) => n + words(x.narration), 0);
  if (total < budget.minWords) return { ok: false, error: `Script too short: ${total} words (needs at least ${budget.minWords}).` };

  const hook_text = str(d.hook_text);
  if (!hook_text) return { ok: false, error: "The script has no hook card." };
  if (words(hook_text) > HOOK_TEXT_MAX_WORDS || hook_text.length > HOOK_TEXT_MAX) return { ok: false, error: `The hook card is longer than ${HOOK_TEXT_MAX_WORDS} words.` };
  if (GREETING_RE.test(hook_text) || CTA_RE.test(hook_text)) return { ok: false, error: "The hook card is a greeting or a call to action, not a hook." };
  if (norm(hook_text) === norm(lines[0].narration)) return { ok: false, error: "The hook card repeats line 1 instead of adding to it." };

  // the shot list follows the rules (lib/reels/shots) without overriding a size the idea implies; the repair only
  // changes the shot (the prompt's size + lens part), never the idea's words. The last line is set where line 1 is (the
  // loop) only when its own idea names no place.
  // A guide scene is a few full sentences (the guide's own examples say "one tiny hand reaching", "looking down"): its
  // wording never locks a shot size there; the builder states the shot itself.
  const shots = repairShotList(raws.map((o, i) => ({ shot_size: o.shot_size, subject: o.subject, idea: guide ? "" : lines[i].idea })));
  const n = lines.length;
  if (n >= 3 && lines[0].setting && !namesPlace(lines[n - 1].idea)) lines[n - 1].setting = lines[0].setting;
  const punches = capPunches(lines.map((x, i) => punchIn(x.narration, raws[i].punch)));
  const scenes: ReelScriptScene[] = lines.map((x, i) => ({
    beat: x.beat, narration: x.narration, idea: joinIdea(x.idea, x.setting), emotion: x.emotion, action: x.action,
    shot_size: shots[i].shot_size, subject: shots[i].subject, punch: punches[i], time_jump: i > 0 && raws[i].time_jump === true,
    ...(guide ? { feeling: x.feeling, thread: x.thread } : {}),
  }));
  return { ok: true, script: { title, stage, cast, hook_text, scenes } };
}

/** Write a reel script with Gemini. Never throws. */
export async function writeReelScript(input: ReelScriptInput): Promise<ReelScriptResult> {
  try {
    const { system, prompt } = reelScriptPrompt(input);
    const r = await generateJson<Record<string, unknown>>({
      system, prompt, schema: schemaFor(input.theme?.id ?? DEFAULT_THEME_ID), model: REEL_SCRIPT_MODEL, thinkingLevel: "low", temperature: 1,
      timeoutMs: input.timeoutMs ?? REEL_SCRIPT_TIMEOUT_MS,
      parse: (x) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null),
    });
    if (!r.ok) return { ok: false, error: r.error };
    return validateReelScript(r.data, input.maxScenes, input.speed, input.theme?.id ?? DEFAULT_THEME_ID);
  } catch (e) {
    return { ok: false, error: `Could not write the script (${e instanceof Error ? e.message.slice(0, 120) : "unknown error"}).` };
  }
}
