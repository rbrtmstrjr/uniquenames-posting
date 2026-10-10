import "server-only";
import { emotionOf, REEL_EMOTIONS, type ReelEmotion } from "@/lib/reels/motion";
import { childAge, joinIdea, type ReelCast } from "@/lib/reels/prompt";
import { cleanFeeling, cleanScene, FEELING_FOR_EMOTION, isGuideThemeId, REEL_THREADS, threadFor, type ReelThread } from "@/lib/reels/guide";
import {
  capPunches, PUNCH_MAX, PUNCH_MAX_WORDS, punchIn, REEL_SHOT_SIZES, REEL_SUBJECTS, repairShotList,
  type ReelShotSize, type ReelSubject,
} from "@/lib/reels/shots";
import { DEFAULT_THEME_ID, isDollTheme, type ReelTheme } from "@/lib/reels/themes";
import { FORMAT_SPECS, isReelFormat, QUOTE_RE, quoteCount, REEL_FORMATS, type ReelFormat } from "@/lib/reels/formats";
import type { GeminiSchema } from "./gemini";
import { plainWordsProblem } from "./plain-words";
import { aiJson } from "./provider";

/** Same model as the n8n Knitted Doll storyboard. */
export const REEL_SCRIPT_MODEL = "gemini-3.1-pro-preview";
/** Default budget (3.1 Pro took ~40 s; Opus 5.5 needs ~105-140 s for a 60-90 s script); callers pass what is left of their own budget. */
export const REEL_SCRIPT_TIMEOUT_MS = 180_000;
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
/**
 * Reel length (owner, 2026-10-10: at least 1 minute when the script keeps hooking; the prompt aims for 65-80 s) and the
 * narrator's pace at 1×. `floor` = the shortest speech ever asked for when few images are allowed.
 * Pace: the line-by-line voice (worker 2.6.0, retuned Gacrux with 0.4-0.7 s between lines) measured 155-160 words a
 * minute including the pauses (was 3.8 words/s for the old tightened, chunked voice).
 */
export const REEL_SECONDS = { lo: 60, hi: 90, floor: 15 } as const;
/** The part of the 60-90 s range the prompt aims for (65-80 s). */
const AIM_SECONDS = { lo: 65, hi: 80 } as const;
export const WORDS_PER_SECOND = 2.67;
/** The on-screen label of a line (drawn by the worker while it is spoken): at most this many words / characters. */
export const ON_SCREEN_MAX_WORDS = 8;
export const ON_SCREEN_MAX = 80;
/** At most this many lines carry a label (more text on screen loses viewers); later ones are dropped. */
export const ON_SCREEN_MAX_LINES = 8;

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
  /** 014: the short label drawn at the top while the line is spoken (never on line 1); null = none. */
  on_screen: string | null;
}
export interface ReelScript {
  title: string; stage: ReelStage; cast: ReelCast;
  /** The format the script is written in (lib/reels/formats). */
  format: ReelFormat;
  /** The hook card (≤ 10 words) that complements line 1. */
  hook_text: string;
  scenes: ReelScriptScene[];
}
/** An earlier reel, newest first, for the "already made" block. */
export interface MadeReel { title: string; stage?: string | null }
export interface ReelScriptInput {
  topic?: string; maxScenes: number; alreadyMade: MadeReel[]; timeoutMs?: number;
  /** The format to write in (rotated by the caller: lib/reels/formats nextFormat). */
  format: ReelFormat;
  /** A fever / illness / sleep / feeding / development topic: soft wording and one safety line. */
  topicHealth?: boolean;
  /** A bank health topic's vetted facts (the only medical claims allowed) and its safety line. */
  topicFacts?: string[]; topicSafety?: string;
  /** A verified term the reel may attribute to experts ("<term> — <who uses it>"). */
  topicAnchor?: string;
  /** Narration speed (settings.reel_speed, 1.00–1.25; default 1 = unchanged): a faster voice fits more words in the same time. */
  speed?: number;
  /** The reel's visual theme (default Crayon): the cast is written as dolls only for Knitted Doll; Crayon and Red
   *  Thread get each line's picture written to the owner's style guide. */
  theme?: Pick<ReelTheme, "id" | "faces">;
}
export type ReelScriptResult = { ok: true; script: ReelScript } | { ok: false; error: string };

const BEATS = ["hook", "build", "turn", "close"];

export const REEL_SCRIPT_SYSTEM = [
  "You write short, useful narrated vertical reels for a Facebook page whose audience is moms of babies and young kids (0-7) around the world; most are in the Philippines, others in the US, Africa, Australia and beyond. Every reel teaches ONE thing a mom can use tonight, with the exact words to say, spoken straight to her ('you', 'your toddler') like a warm friend who read the research. Warm and practical, never a lecture, never a sad story. Simple, warm English anyone understands, no emojis, no hashtags.",
  "",
  "HUMAN, NATURAL TONE (very important): Write the way a real, warm person actually TALKS. Use contractions (you're, don't, it's). Short spoken sentences, concrete details (an age, a time, an object, an exact phrase) over abstractions. Validate the parent first, never shame her. STRICTLY AVOID AI-sounding tells and clichés: no 'in today's world', 'let's dive in', 'when it comes to', 'simply', 'furthermore', 'moreover', 'journey', 'it is important to note', stiff listy phrasing or formal transitions.",
  "",
  "WHO YOU'RE TALKING TO: a busy, tired mom who loves her kids fiercely, in everyday family life anywhere (home, bedtime, bath time, mealtime, the park, the store, drop-off, a family visit). Give her something she can do, in words she can say, and leave her feeling capable. At most ONE everyday detail, one that families everywhere know (the bath, the dinner table, the shoes by the door); nothing tied to one country (no holidays, store names, money amounts or local customs).",
  "",
  "SIMPLE GLOBAL ENGLISH (CRITICAL): never a Filipino or Tagalog word or Taglish (no anak, lola, lolo, nanay, tatay, kuya, ate as a title, bunso, po, opo, salamat, mahal, ingat, naman, talaga, diba, kasi, lang, mga), no Filipino-only places, foods or customs (sala, jeepney, palengke, merienda, mano, pamahiin, kulob, usog, hamog), no abbreviations for overseas workers (say 'a parent working abroad'), and no slang from any one region. Grandparents are Grandma and Grandpa; the room is the living room; a snack is a snack.",
  "",
  "PLAIN, SIMPLE LESSONS (CRITICAL): write so a busy mom gets it on the first listen: everyday words, about a 5th-6th grade reading level, short concrete sentences, one idea per line. No jargon and no clinical or academic words. If research backs a tip, say it plainly ('Child experts say naming the feeling helps kids calm down.'); never name a technique, study, therapy, program or brain part (no affect labeling, Parent-Child Interaction Therapy, PCIT, serve and return, co-regulation, executive function, amygdala, prefrontal cortex, cortisol, dopamine, attachment theory, nervous system, Harvard). Your own catchy tip names ('the Two-Choice Rule') are fine. Practical and concrete, never deep or abstract: say what to do and what happens next, not what it 'means'.",
  "- Bad: 'Affect labeling calms the amygdala and builds emotional regulation.' Good: 'Name the feeling out loud. It helps her calm down faster.'",
  "- Bad: 'The bond you share transcends every mile between you.' Good: 'Call at the same time every night. He'll start waiting for it.'",
  "",
  "AGE FOCUS (CRITICAL): ONLY the early years — newborns (0-3 months), babies (3-12 months), toddlers (1-3 years) and young children (3-5 years). Never a tween or teenager.",
].join("\n");

/** An on-screen label pattern per format (each format labels its own key lines). */
const LABEL_PATTERN: Record<ReelFormat, string> = {
  named_method: "'1/5 · Get low' on each numbered step",
  say_this: "'Instead: \"Walking feet\"' on each swap",
  lola_science: "'Doctors say: fluids first' on the fact, 'Verdict: let go, gently' on the verdict",
  scene_lesson: "'Say: \"You carry the keys\"' on the script to say",
  problem_fix: "'The fix: \"Gentle hands\"' on the fix",
};

/** What the hook card names, per format (research §8.1): never another format's series name. */
const HOOK_CARD: Record<ReelFormat, string> = {
  named_method: "the method's name (pattern: 'THE 5-WORD RULE')",
  say_this: "the contrast (pattern: 'SAY THIS, NOT THAT')",
  lola_science: "the myth check (pattern: 'GRANDMA SAID… SCIENCE SAYS')",
  scene_lesson: "the lesson in a few words, never a series name (pattern: 'LATE, ONE SHOE, NO YELLING')",
  problem_fix: "the problem or the fix's name (pattern: 'BEDTIME TAKES AN HOUR?')",
};

const AUTO_TOPIC = "Topic: (none given) — CHOOSE one specific, useful topic from early parenting (0-5 years) that suits the format: a concrete problem, method, myth or phrase, never a vague one, and clearly different from the already-made reels.";

/** Health topics (fever, illness, sleep, feeding, development): research §6.2 / §10.4 + the bank's vetted facts. */
function healthRules(facts?: string[], safety?: string): string {
  return [
    "HEALTH TOPIC (CRITICAL): soft wording only ('can help', 'many pediatricians suggest'); no diagnosis, no symptom checklists, no doses, no medicines, supplements or products; never 'proven', 'cures', 'forever' or 'doctors won't tell you'. Infant sleep advice goes no further than 'back to sleep, on a flat, clear surface'. Never explain how the body works (temperature going up or down, hormones, cortisol, adrenaline, melatonin): describe what parents notice and what to do for comfort.",
    ...(facts?.length
      ? ["- MEDICAL FACTS (checked sources) — these are the ONLY medical claims this reel may make: restate them in plain words, with no mechanisms, causes or numbers beyond them:", ...facts.map((f) => `  - ${f}`)]
      : ["- No vetted facts for this topic: keep every medical claim general ('for comfort', 'ask your pediatrician'), with no mechanisms, causes or numbers."]),
    safety
      ? `- SAFETY LINE: exactly one line saying this, in your own words: ${safety}`
      : "- SAFETY LINE: exactly one generic line that says when to call the doctor or pediatrician, in your own words (pattern: 'If you're worried, call your pediatrician.').",
  ].join("\n");
}

/** Claims the script may state as fact (research §10.4 S3, in plain words since 2026-10-10); anything else is a tip many parents find helps. */
const VETTED_CLAIMS = [
  "naming a feeling out loud helps a child calm down",
  "talking back and forth with a baby (you answer their sounds and looks) helps their brain grow",
  "a baby's brain grows faster in the first few years than at any other time",
  "picky eaters often need 8-15 low-pressure tries of a new food",
  "watching shows together and talking about them helps kids learn words",
  "pediatricians now look at what kids watch and whether you watch together, not only the hours",
  "praise that names exactly what your child did, and a few minutes a day of play your child leads, can help behavior",
  "the parent decides what, when and where food is served; the child decides how much",
];

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Spoken-word budget for a 60-90 s reel: seconds × 2.67 words/s × the narration speed (a sped-up voice fits more words),
 * shrunk when few images are allowed (8-12 words a line) but never under 18 s of speech; the prompt aims for the
 * `aimLo`-`aimHi` part (65-80 s). A script is accepted with at least `minScenes` lines and `minWords` (all of `lo`: the
 * owner wants at least a minute) to `maxWords` (110 % of `hi`) words; the prompt asks for `minScenes`-`maxLines` lines.
 * At 1× with 40 images: 160-240 words (aim 173-213), 14-35 lines.
 */
export function reelWordBudget(maxScenes: number, speed = 1) {
  const x = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const rate = WORDS_PER_SECOND * x;
  const lo = Math.max(Math.ceil(rate * 18), Math.min(Math.round(rate * REEL_SECONDS.lo), maxScenes * 8));
  const hi = Math.max(lo, Math.min(Math.round(rate * REEL_SECONDS.hi), maxScenes * 12));
  const span = REEL_SECONDS.hi - REEL_SECONDS.lo;
  const aimLo = Math.round(lo + ((hi - lo) * (AIM_SECONDS.lo - REEL_SECONDS.lo)) / span);
  const aimHi = Math.round(lo + ((hi - lo) * (AIM_SECONDS.hi - REEL_SECONDS.lo)) / span);
  const minScenes = Math.min(maxScenes, Math.max(2, Math.ceil(lo / 12)));
  return {
    lo, hi, aimLo, aimHi, minScenes,
    maxLines: Math.max(minScenes, Math.min(maxScenes, Math.ceil(hi / 7))),
    minWords: Math.max(lo, Math.ceil(rate * REEL_SECONDS.floor)),
    maxWords: Math.floor(1.1 * hi),
    secLo: Math.round(lo / rate), secHi: Math.round(hi / rate),
    secAimLo: Math.round(aimLo / rate), secAimHi: Math.round(aimHi / rate),
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
/** Red Thread: the page's trademark, and the stories it suits (connection and distance; many of the page's parents work abroad). */
const RED_THREAD_STORY = "THIS STYLE (the owner's Red Thread guide): every picture is black-and-white storybook line art where ONE bright red thread ties the parent's wrist to the child's wrist — the page's trademark, in every picture. Stories where connection and distance matter are especially welcome: a parent working abroad or far away (away for work, deployed) and the child waiting at home, the first day apart, a reunion at the airport, a small fight that cannot break the bond, a hard season the bond survives. The bond holds in every picture; the thread itself is drawn automatically.";

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
    ...(red ? [`- "thread": the red thread between the parent's and the child's wrists in this picture, exactly one of ${REEL_THREADS.join("|")}: tight = closeness, a hug; stretched = distance (a parent working abroad, leaving for work, the first day apart); tangled = a conflict or a misunderstanding; loose = hard times, the bond still holds; plain = an ordinary tender moment.`] : []),
    "- PEOPLE, NOT DOLLS: write every scene and cast line with real people and real things.",
  ];
}

/**
 * The script prompt (value-first formats, spec 2026-10-09-reel-storylines: the format's beats, the research §10 rules,
 * the on-screen labels + the playbook's varied shot list and the style's picture rules); `alreadyMade` is newest first.
 */
export function reelScriptPrompt({ topic, maxScenes, alreadyMade, speed, theme, format, topicHealth, topicFacts, topicSafety, topicAnchor }: ReelScriptInput): { system: string; prompt: string } {
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
  const f = FORMAT_SPECS[isReelFormat(format) ? format : "problem_fix"];
  const q = f.minQuotes;
  const prompt = [
    t ? `Topic: ${t}` : AUTO_TOPIC,
    "",
    `FORMAT: ${f.label} (${f.id}). Write the reel in these beats, in this order (one or more spoken lines per beat):`,
    ...f.beats.map((x, i) => `${i + 1}. ${x}`),
    "",
    "ALREADY MADE — DO NOT REPEAT: titles you have ALREADY produced. Do NOT repeat any of these titles or the same angle; choose a CLEARLY DIFFERENT title and (when possible) a different stage from the recent ones:",
    made.length ? made.map((m) => `- ${m.title}${m.stage ? ` (${m.stage})` : ""}`).join("\n") : "(none yet — this is the first one)",
    "",
    "THE SCRIPT (CRITICAL — value first: the mom must be able to USE this tonight):",
    `- LINE 1 is the hook, spoken in the first half-second: at most ${HOOK_LINE_MAX_WORDS} words (aim for 6-10). It names the SPECIFIC problem, method, myth or exact phrase of this reel, says 'you' or 'your' (child / toddler / baby), and promises something concrete. Never a vague feeling, never scene-setting about the weather or the time of day.`,
    "- Talk to the mom in the second person ('you', 'your toddler'), like a friend who read the research. NEVER the first person: no I / me / my / we / us / our in the narration (only line 1 may say 'we all', as in '3 things we all say…'), no personal stories, no 'as a mom' (write 'You might think…', never 'We often think…'). The words inside quotes are what the mom says, so they may use I / we.",
    `- THE EXACT WORDS: the fix is always EXACT WORDS the mom can say tonight, in double quotes inside the line (e.g. Say "You're mad. Tower fell."): each quote at most 10 words (at most 5 for a toddler), opened and closed within ONE line. This reel needs at least ${q} quoted phrase${q === 1 ? "" : "s"}.`,
    `- ONE soft anchor per reel, said in plain words: ${topicAnchor ? `use this checked one, in your own plain words ('Child experts say …'): ${topicAnchor}` : "a plain one ('pediatricians suggest…', 'child experts say…', 'many parents find…')"}. Never say experts 'call it' something, never coin a term and attribute it to experts, and never name a technique, study or therapy. Your own tip names ('the Two-Choice Rule') are fine as tip names, never credited to experts. Never invent studies, numbers, percentages, quotes or experts, and never 'proven', 'cures', 'forever', 'doctors won't tell you'. Facts you may state: ${VETTED_CLAIMS.join("; ")}. Anything else is a tip many parents find helps.`,
    "- Sentences of 4-12 words (never more than 15), one idea per line. Link beats with 'but', 'so' or 'because', never 'and then'. A short 2-4-word punch line in most beats ('Five words. Big feelings.').",
    "- Emotion: validate first ('You're not doing it wrong'), then teach, then end on relief or warmth — never on guilt, fear or sadness.",
    "- The LAST line is the warm close of the format (a reframe or a gentle 'tonight, try it once'). No tagline, no sign-off, no page name.",
    "- BANNED anywhere: greetings ('Hey mommies', 'Hello mama', 'Welcome back'), 'Today I want to talk about', 'In this video', 'Let me tell you', outros ('see you next time', 'thanks for watching', 'next video', 'until next time'), 'watch till the end', fear absolutes ('damages your child forever'). NEVER ask viewers to like, comment, share, tag, follow, save, subscribe or vote — no call to action of any kind.",
    "- The examples in this brief (the beats included) are PATTERNS only: they belong to other topics. Write fresh words for THIS topic and never reuse an example sentence, an example's method name or an example's fix, unless the topic is exactly that example.",
    "",
    `RETENTION FOR A ${b.secLo}-${b.secHi} SECOND REEL (CRITICAL — a longer reel only works when every few seconds give her a reason to stay):`,
    "- OPEN LOOP: early on (by line 4), promise something still to come and leave it open ('The last step is the one most moms skip.'); pay it off later in the reel, never forget it.",
    "- A RE-HOOK every 10-15 seconds (about every 4-6 lines): a 'but' / 'here's the part…' line that pulls her into the next beat ('But the third one is the one most moms skip…', 'Here's the part nobody tells you…', 'And this next one feels wrong at first.'). Numbered step or swap markers ('Two…', 'Swap three…') count as re-hooks too. Fresh words for this topic; never the same re-hook twice in a reel.",
    "- MORE SUBSTANCE, NEVER PADDING: the extra length comes from the format's beats — more steps, the exact words for each, a tiny real-life example, what to do when it doesn't work — never from filler. Every line says something NEW: no recap ('as I said', 'like I said', 'to sum up', 'let's recap'), no repeating a step, a quote or an earlier line in other words, no stalling ('okay so', 'now here's the thing').",
    "- Save the strongest beat (the 'why it works' reveal or the 'if it doesn't work' fix) for the last third, then land the warm close.",
    ...(topicHealth ? ["", healthRules(topicFacts, topicSafety)] : []),
    "",
    `ON-SCREEN LABELS: "on_screen" is an optional short label shown big at the top of the picture while that line is spoken: at most ${ON_SCREEN_MAX_WORDS} words and 60 characters, only on the format's key lines (steps, swaps, the script to say, the verdict), 3-8 lines per reel (pattern for this format: ${LABEL_PATTERN[f.id]}). It complements the spoken line, never repeats it whole. "" on every other line, and ALWAYS "" on line 1 (the hook card owns the first seconds).`,
    "",
    `LENGTH (CRITICAL): narration for a ${b.secLo}-${b.secHi} second reel at about ${b.wps} words per second = ${b.lo}-${b.hi} words in total; AIM for ${b.aimLo}-${b.aimHi} words (about ${b.secAimLo}-${b.secAimHi} seconds), as ${b.minScenes}-${b.maxLines} lines (never fewer than ${b.minScenes}, never more than ${maxScenes}). Every line is one image on screen for about 2-5 seconds, so keep the lines short. CALM PACE: the narrator speaks slowly and warmly, with a short pause after every line, so fewer words fit than you think: keep every beat and step of the format (4 steps or swaps where it asks for them), and say each in fewer, tighter words; cut filler words, never a step. Under ${b.lo} words (under ${b.secLo} seconds) is TOO SHORT and over ${b.hi} words is TOO LONG: both are rejected. BEFORE ANSWERING, COUNT the lines and the words.`,
    "",
    `THE HOOK CARD: "hook_text" is the big title shown on screen over the first 3.5 seconds: at most ${HOOK_TEXT_MAX_WORDS} words, it COMPLEMENTS line 1 and never repeats it word for word — ${HOOK_CARD[f.id]}. Fresh words for this reel, never an example sentence from this brief. Keep it short and big on screen: ideally at most 8 words and 45 characters.`,
    "",
    `SELF-CHECK BEFORE ANSWERING: line 1 has at most ${HOOK_LINE_MAX_WORDS} words, 'you'/'your' and a specific promise; the open loop is paid off; a re-hook every 4-6 lines; no line repeats an earlier one and none is filler; at least ${q} quoted phrase${q === 1 ? "" : "s"} of exact words; no banned phrase and no I / we narration; ${b.aimLo}-${b.aimHi} words (never under ${b.lo})${topicHealth ? "; the safety line is there" : ""}${f.id === "scene_lesson" ? "; the pivot ('Here's what's really happening.') is line 5 or earlier, with the scene before it in at most 3 lines" : ""}; the last line ends warm.`,
    "",
    ...(guide ? [red ? RED_THREAD_STORY : CRAYON_STORY, ""] : []),
    "THE CAST:",
    "- ONE recurring parent (mom or dad) and ONE young child of the stage that fits the topic (age 0-5 only).",
    castRules(dolls),
    ...(red ? [GREY_CAST_RULE] : []),
    "",
    "PICTURES SHOW THE ADVICE: each line's picture acts out what that line says, as a concrete moment between the parent and the child ('get low' → the mother kneeling at eye level with her crying toddler; a 'say this' line → the parent saying it to the child; a step → the parent doing that step). Never a generic hug that ignores the line. Only the ONE parent and the ONE child ever appear (never grandma, a sibling, a visitor or a crowd): when a line is about someone else, show the parent and the child reacting, or a plain object.",
    "",
    "THE SHOT LIST (CRITICAL — the owner's #1 complaint was nine pictures of 'mom holding baby'; every picture must be a DIFFERENT shot that follows the lines):",
    `- "shot_size": exactly one of ${REEL_SHOT_SIZES.join("|")}. Per 10 lines aim for about 2 wide, 3 medium, 2 close, 2 detail (an insert of hands, a small object, a texture) and 1 pov (through the mom's own eyes) or broll (a quiet cutaway of the place or an object, nobody in it).`,
    `- "subject": who is in the picture, exactly one of ${REEL_SUBJECTS.join("|")} — mom = the parent alone, baby = the child alone, both = the two together, object = a thing with nobody in it (tiny socks, a cold cup of coffee, the baby monitor glow), none = an empty place. Use 'both' on at most 4 lines in 10, and show no face (object, none, or a detail of hands) on at least 1 line in every 4.`,
    "- LINE 1 shows a FACE (mom, baby or both) in a close or medium shot — a striking, readable moment, never a calm establishing view. Line 2 or 3 is the establishing WIDE (the whole place).",
    "- Never the same shot_size with the same subject on two lines in a row; never more than 2 face shots in a row.",
    "- The LAST line mirrors line 1: the same subject, the same setting and a similar framing.",
    ...(guide ? [red
      ? "- In this style the thread on the wrist must stay in view: face-free lines are very close detail views of the hands and wrists (subject mom, baby or both with shot_size detail); use subject object or none on at most 1 line."
      : "- In this style every picture of a person shows their face with a BIG, exaggerated expression (the guide's rule; a calm hands-only close-up comes out looking like a photo), so a detail line shows their hands doing something that matters AND their big expression. The face-free line is an object picture: subject object (a few named things on a simple background) on at most 1 line; the other face-free lines are those detail views."] : []),
    "",
    ...(guide ? guidePictureRules(red) : [
    "EACH LINE'S PICTURE (the art style and the cast details are added later by the image system, so keep it plain):",
    `- "idea": what is in the picture — who (by their short names, e.g. ${name}) is doing what, or which object is shown — in one plain sentence that MATCHES the line. Leave out the place (that goes in "setting"), art-style words, lighting, colours, lenses and framing jargon. Describe only what IS in the picture (never what is absent). Pictures carry no writing: never signs, labels, books with words, screens with text, letters or numbers.`,
    ...(dolls ? [] : ["- PEOPLE, NOT DOLLS: this theme draws real people, so write every idea, action and cast line with people and real things — never doll, yarn, crochet, knitted, felt or wool wording for bodies or toys (say 'tiny feet', 'toy blocks')."]),
    "- \"setting\": the place + time of day in at most 8 words ('the dim nursery at 3 a.m.', 'the living room on a rainy afternoon', 'the park at dusk'). The reel can move between a few places; the last line uses the SAME setting as line 1.",
    "- \"action\": the body language and what the hands do, in one short phrase ('kneels and cups the toddler's cheeks in both hands'); '' for object / none shots. Describe only what the body IS doing.",
    feelingRule(dolls, th.faces),
    ]),
    `- "emotion": exactly one of ${REEL_EMOTIONS.join("|")}. Follow the reel's arc (validate, teach, relief); never the same emotion on more than 2 lines in a row.`,
    `- "punch": the ONE stressed word or short phrase (at most ${PUNCH_MAX_WORDS} words, copied EXACTLY from that line's narration) that hits hardest, on at most ${PUNCH_MAX} lines in the whole reel (2-4 of the biggest beats, one of them on the key fix); "" on every other line.`,
    "- \"time_jump\": true only on a line that jumps forward or back in time ('Years later…', 'Tomorrow she'll be three.'); false otherwise and always false on line 1.",
    "- \"beat\": hook on line 1, build on the body lines, turn on the 'why it works' / pivot line, close on the last line.",
    "",
    "Return ONLY JSON in EXACTLY this shape:",
    "{",
    '  "title": "<short internal title in plain words with spaces (never an id), at most 60 characters, different from every already-made title>",',
    '  "stage": "<exactly one of newborn|baby|toddler|preschooler>",',
    `  "format": "${f.id}",`,
    `  "hook_text": "<the hook card, at most ${HOOK_TEXT_MAX_WORDS} words>",`,
    '  "cast": { "adult": "<exact fixed description>", "child": "<exact fixed description>", "adult_tag": "<at most 7 words>", "child_tag": "<at most 7 words>", "child_age": "<e.g. a 10-month-old baby boy>" },',
    guide
      ? `  "scenes": [ { "beat": "<hook|build|turn|close>", "narration": "<the spoken line>", "scene": "<the picture, written to the style guide>", "feeling": "<completes 'The feeling is …'>", ${red ? `"thread": "<${REEL_THREADS.join("|")}>", ` : ""}"shot_size": "<${REEL_SHOT_SIZES.join("|")}>", "subject": "<${REEL_SUBJECTS.join("|")}>", "emotion": "<${REEL_EMOTIONS.join("|")}>", "punch": "<word(s) from the line, or empty>", "time_jump": <true|false>, "on_screen": "<a short label, or empty>" } ]`
      : `  "scenes": [ { "beat": "<hook|build|turn|close>", "narration": "<the spoken line>", "idea": "<what is in the picture>", "setting": "<place + time of day>", "shot_size": "<${REEL_SHOT_SIZES.join("|")}>", "subject": "<${REEL_SUBJECTS.join("|")}>", "emotion": "<${REEL_EMOTIONS.join("|")}>", "action": "<body language + hands>", "punch": "<word(s) from the line, or empty>", "time_jump": <true|false>, "on_screen": "<a short label, or empty>" } ]`,
    "}",
  ].join("\n");
  return { system: REEL_SCRIPT_SYSTEM, prompt };
}

const SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", description: "short internal title, at most 60 characters" },
    stage: { type: "STRING", enum: [...REEL_STAGES] },
    format: { type: "STRING", enum: [...REEL_FORMATS] },
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
          on_screen: { type: "STRING", nullable: true, description: `a short on-screen label (at most ${ON_SCREEN_MAX_WORDS} words) on step / swap / verdict lines, or empty; always empty on line 1` },
        },
        required: ["beat", "narration", "idea", "setting", "shot_size", "subject", "emotion", "action", "punch", "time_jump", "on_screen"],
      },
    },
  },
  required: ["title", "stage", "format", "hook_text", "cast", "scenes"],
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
/**
 * A spoken call to action (the playbook bans them: no follow / comment / tag / share / save / subscribe / vote / like).
 * "Like this" only at the start of a sentence or before video / reel / post: "Say it like this:" introduces the words.
 */
export const CTA_RE = /\b(?:follow (?:me|us|the page|this page|for more|along)|comment (?:below|down|if|your)|tag (?:a|your|someone|every|another)|share (?:this|it) (?:with|to)|save this|like and|(?<=^|[.!?]\s+)like (?:this|if)|like this (?:video|reel|post|page)|hit (?:the )?(?:like|follow|share)|link in (?:the )?bio|subscribe|vote (?:below|now|for|in the)|watch (?:till|until|to) the end|stay (?:till|until) the end)\b/i;
/** A spoken sign-off (banned on every line). */
export const OUTRO_RE = /\b(?:see you (?:next|in the next|tomorrow|soon)|thanks for watching|thank you for watching|next video|until next time|bye for now)\b/i;
/** Narrator first person (the mom's own words in quotes and the "we all" of a hook are fine). Case-sensitive "I". */
const FIRST_PERSON_I = /(?<![\p{L}'])I(?:'m|'ve|'ll|'d)?(?![\p{L}'])/u;
const FIRST_PERSON = /(?<![\p{L}'])(?:me|my|mine|myself|we|we're|we've|we'll|us|our|ours)(?![\p{L}'])/iu;
export { quoteCount, quotedPhrases } from "@/lib/reels/formats";
/** A single-quoted phrase ('I'm here.') the mom says: never counted as the narrator's own words. */
const SINGLE_QUOTE_RE = /(^|[\s:,(])'(.+?)'(?=$|[\s.,!?;:)])/g;
/** The narrator's first-person word in the line (outside the quotes; the hook may say "we all"), or null. */
export function narratorFirstPerson(line: string, hook = false): string | null {
  let out = line.replace(/[\u2018\u2019]/g, "'").replace(QUOTE_RE, " ").replace(SINGLE_QUOTE_RE, "$1 ");
  if (hook) out = out.replace(/\bwe all\b/gi, " ");
  return (out.match(FIRST_PERSON_I) ?? out.match(FIRST_PERSON))?.[0] ?? null;
}
/** A health topic's safety line names the doctor. */
const SAFETY_RE = /\b(?:doctor|doctors|pediatrician|paediatrician|health center|health centre|clinic)\b/i;

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

/** A line's on-screen label, or null: never on line 1, at most 8 words / 80 characters (a longer one is dropped). */
export function cleanOnScreen(v: unknown, index: number): string | null {
  if (index === 0) return null;
  const s = str(v);
  if (!s || words(s) > ON_SCREEN_MAX_WORDS || s.length > ON_SCREEN_MAX) return null;
  return sentenceCase(s);
}

/** A label written in capitals ("HERE IS THE REAL REASON") in sentence case; any other label is kept as written. */
export function sentenceCase(s: string): string {
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2 || letters !== letters.toUpperCase()) return s;
  return s.toLowerCase()
    // the first letter, and the first letter after an opening quote or a "·" separator
    .replace(/(^|["“]|·\s*)(\p{L})/gu, (_, pre: string, c: string) => pre + c.toUpperCase())
    .replace(/(?<![\p{L}'])i(?=$|[\s'’.,!?;:])/gu, "I");
}

/** A body-mechanism claim (temperature going up / down, hormones): never in a reel (health accuracy). */
const MECHANISM_RE = /\b(?:rais(?:e|es|ing)|lower(?:s|ing)?|bring(?:s|ing)? (?:down|up)|drop(?:s|ping)?|reduc(?:e|es|ing)|pulls? (?:the )?heat) (?:a |the |their |his |her |your |its )?(?:mild |high |body |child's |baby's )*(?:temperature|fever)\b|\bbring(?:s|ing)? (?:a |the |their |his |her |your )?(?:body )?(?:temperature|fever) (?:down|up)\b|\b(?:cortisol|adrenaline|melatonin|hormones?|dopamine|serotonin)\b/i;
/** "Experts call it …": only for a verified term. */
const EXPERT_RE = /\b(?:experts?|psychologists?|pediatricians?|paediatricians?|doctors?|scientists?|researchers?|therapists?|specialists?)\b/i;
const CALL_RE = /\b(?:call(?:s|ed)? (?:it|this|that)|(?:it|this|that)(?:'s| is) called|known as)\b/i;
/** The scene_lesson pivot. */
const PIVOT_RE = /\b(?:really (?:happening|going on)|here's why|here is why|here's what|here is what)\b/i;
/** A first line that reassures instead of naming the problem. */
const REASSURE_RE = /\b(?:don't|do not) (?:feel bad|worry|panic|stress)\b/i;
/** Recap / filler that pads a longer reel instead of adding to it. */
export const PADDING_RE = /\b(?:as I (?:said|mentioned)|like I (?:said|mentioned)|as (?:we|you) (?:saw|heard|learned)|as mentioned|to (?:sum|wrap) (?:it |this |things )?up|let's recap|to recap|in summary|in conclusion|long story short)\b/i;
/** Lines of at least this many words are compared for near-duplicates (a short refrain like "Same words. Every time." may return). */
export const DUPLICATE_MIN_WORDS = 5;
/** Word overlap (Jaccard) at which a line counts as a repeat of an earlier one (one word swapped in an 8-word line = 0.78). */
export const DUPLICATE_SIMILARITY = 0.75;
/** The 1-based numbers of a line that repeats an earlier one ([line, earlier]), or null. */
export function repeatedLine(narrations: string[]): [number, number] | null {
  const sets = narrations.map((n) => new Set(norm(n).split(" ").filter(Boolean)));
  for (let i = 1; i < sets.length; i++) {
    if (sets[i].size < DUPLICATE_MIN_WORDS) continue;
    for (let j = 0; j < i; j++) {
      if (sets[j].size < DUPLICATE_MIN_WORDS) continue;
      let shared = 0;
      for (const w of sets[i]) if (sets[j].has(w)) shared++;
      if (shared / (sets[i].size + sets[j].size - shared) >= DUPLICATE_SIMILARITY) return [i + 1, j + 1];
    }
  }
  return null;
}

export interface ValidateOptions {
  /** The format the script was asked for (default: Gemini's own, else problem_fix). */
  format?: ReelFormat;
  /** A health topic: a safety line is required. */
  health?: boolean;
  /** The topic's verified anchor ("<term> — <who>"): its term may be attributed to experts. */
  anchor?: string;
}

/**
 * Check and normalise Gemini's JSON into a script (shot list repaired), or say what is wrong. `themeId` = the reel's
 * theme: Crayon and Red Thread lines carry a guide [SCENE] (stored as the idea), a feeling and (Red Thread) a thread.
 * The value-first rules: no greeting / outro / call to action / narrator "I" on any line, enough quoted phrases for the
 * format, a safety line on a health topic, 60-90 s of words, no recap / filler and no line repeating an earlier one,
 * no Filipino / Tagalog word and no expert jargon in the title, a line, a label or the hook card (lib/ai/plain-words);
 * on-screen labels are cleaned, never rejected.
 */
export function validateReelScript(raw: unknown, maxScenes: number, speed = 1, themeId?: string | null, opts: ValidateOptions = {}): ReelScriptResult {
  const guide = isGuideThemeId(themeId);
  const red = themeId === "redthread";
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // a title written like an id ("grandma_science_bath") is turned back into words
  const title = str(d.title).replace(/_+/g, " ").trim();
  if (!title) return { ok: false, error: "The script has no title." };
  if (title.length > TITLE_MAX) return { ok: false, error: `The title is longer than ${TITLE_MAX} characters.` };
  const titleWords = plainWordsProblem(title);
  if (titleWords) return { ok: false, error: `The title ${titleWords}.` };
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
  const format: ReelFormat = opts.format ?? (isReelFormat(str(d.format)) ? (str(d.format) as ReelFormat) : "problem_fix");
  const list = Array.isArray(d.scenes) ? d.scenes.slice(0, maxScenes) : [];
  const anchorTerm = opts.anchor?.split(" — ")[0].trim().toLowerCase();
  // since 2026-10-10 no named technique is "vetted" (plain lessons): only the topic's own anchor may follow "call it"
  const terms = anchorTerm ? [anchorTerm] : [];
  if (list.length < 2) return { ok: false, error: "The script needs at least 2 scenes." };
  const budget = reelWordBudget(maxScenes, speed);
  const lines: {
    beat: string; narration: string; idea: string; setting: string; emotion: ReelEmotion; action: string;
    feeling: string | null; thread: ReelThread | null; on_screen: string | null;
  }[] = [];
  const raws: Record<string, unknown>[] = [];
  for (const [i, s] of list.entries()) {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const narration = str(o.narration);
    if (!narration) return { ok: false, error: `Line ${i + 1} has no words.` };
    if (words(narration) > LINE_MAX_WORDS) return { ok: false, error: `Line ${i + 1} is longer than ${LINE_MAX_WORDS} words.` };
    if (CTA_RE.test(narration)) return { ok: false, error: `Line ${i + 1} asks viewers to follow, comment, tag or share.` };
    if (i === 0 && GREETING_RE.test(narration)) return { ok: false, error: "Line 1 is a greeting, not a hook." };
    if (GREETING_RE.test(narration) || OUTRO_RE.test(narration)) return { ok: false, error: `Line ${i + 1} is a greeting or an outro.` };
    if (MECHANISM_RE.test(narration)) return { ok: false, error: `Line ${i + 1} explains how the body works (temperature, hormones): keep to the vetted facts.` };
    // simple global English (owner, 2026-10-10): no Filipino / Tagalog word and no expert jargon on any line or label
    const plain = plainWordsProblem(narration);
    if (plain) return { ok: false, error: `Line ${i + 1} ${plain}.` };
    const labelWords = plainWordsProblem(str(o.on_screen));
    if (labelWords) return { ok: false, error: `Line ${i + 1}'s on-screen label ${labelWords}.` };
    if (EXPERT_RE.test(narration) && CALL_RE.test(narration) && !terms.some((t) => narration.toLowerCase().includes(t))) {
      return { ok: false, error: `Line ${i + 1} says experts call it something unverified: use a plain anchor.` };
    }
    if (i === 0 && REASSURE_RE.test(narration)) return { ok: false, error: "Line 1 must name the problem or the mistake, not reassure." };
    const pad = narration.match(PADDING_RE);
    if (pad) return { ok: false, error: `Line ${i + 1} is filler or a recap ("${pad[0]}"): every line must say something new.` };
    const me = narratorFirstPerson(narration, i === 0);
    if (me) return { ok: false, error: `Line ${i + 1} speaks as I / we ("${me}"): talk to the mom as you.` };
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
    const beat = BEATS.includes(str(o.beat)) ? str(o.beat) : "build";
    const action = guide ? "" : lightClean(str(o.action)).slice(0, ACTION_MAX).trim();
    const setting = guide ? "" : lightClean(str(o.setting)).replace(/\s+—\s+/g, ", ").slice(0, SETTING_MAX).trim();
    const feeling = guide ? (cleanFeeling(o.feeling) || scene!.feeling || FEELING_FOR_EMOTION[emotion]) : null;
    const thread = red ? threadFor(o.thread, emotion) : null;
    lines.push({ beat, narration, idea, setting, emotion, action, feeling, thread, on_screen: cleanOnScreen(o.on_screen, i) });
    raws.push(o);
  }
  // at most 8 labels per reel: the first ones stay
  let labels = 0;
  for (const x of lines) if (x.on_screen && ++labels > ON_SCREEN_MAX_LINES) x.on_screen = null;
  if (lines.length < budget.minScenes) return { ok: false, error: `Script too short: ${lines.length} scenes (needs at least ${budget.minScenes}).` };
  const total = lines.reduce((n, x) => n + words(x.narration), 0);
  if (total < budget.minWords) return { ok: false, error: `Script too short: ${total} words (needs at least ${budget.minWords}).` };
  if (total > budget.maxWords) return { ok: false, error: `Script too long: ${total} words (at most ${budget.maxWords}).` };
  const again = repeatedLine(lines.map((x) => x.narration));
  if (again) return { ok: false, error: `Line ${again[0]} repeats line ${again[1]}: every line must say something new.` };

  const hook_text = str(d.hook_text);
  if (!hook_text) return { ok: false, error: "The script has no hook card." };
  if (words(hook_text) > HOOK_TEXT_MAX_WORDS || hook_text.length > HOOK_TEXT_MAX) return { ok: false, error: `The hook card is longer than ${HOOK_TEXT_MAX_WORDS} words.` };
  if (GREETING_RE.test(hook_text) || CTA_RE.test(hook_text)) return { ok: false, error: "The hook card is a greeting or a call to action, not a hook." };
  const hookWords = plainWordsProblem(hook_text);
  if (hookWords) return { ok: false, error: `The hook card ${hookWords}.` };
  if (norm(hook_text) === norm(lines[0].narration)) return { ok: false, error: "The hook card repeats line 1 instead of adding to it." };
  if (format === "scene_lesson" && !lines.slice(1, 5).some((x) => PIVOT_RE.test(x.narration))) {
    return { ok: false, error: "The pivot (\"Here's what's really happening\") must come by line 5." };
  }
  const need = FORMAT_SPECS[format].minQuotes;
  const quotes = quoteCount(lines.map((x) => x.narration));
  if (quotes < need) return { ok: false, error: `The script needs the exact words to say in quotes (at least ${need}, found ${quotes}).` };
  if (opts.health && !lines.some((x) => SAFETY_RE.test(x.narration))) return { ok: false, error: "A health topic needs a safety line (when to call the doctor)." };

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
    ...(guide ? { feeling: x.feeling, thread: x.thread } : {}), on_screen: x.on_screen,
  }));
  return { ok: true, script: { title, stage, format, cast, hook_text, scenes } };
}

/** Write a reel script with the configured AI (Gemini, or Claude with AI_PROVIDER=claude). Never throws. */
export async function writeReelScript(input: ReelScriptInput): Promise<ReelScriptResult> {
  try {
    const { system, prompt } = reelScriptPrompt(input);
    const r = await aiJson<Record<string, unknown>>({
      task: "script", system, prompt, schema: schemaFor(input.theme?.id ?? DEFAULT_THEME_ID), model: REEL_SCRIPT_MODEL, thinkingLevel: "low", temperature: 1,
      timeoutMs: input.timeoutMs ?? REEL_SCRIPT_TIMEOUT_MS,
      parse: (x) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null),
    });
    if (!r.ok) return { ok: false, error: r.error };
    return validateReelScript(r.data, input.maxScenes, input.speed, input.theme?.id ?? DEFAULT_THEME_ID, { format: input.format, health: input.topicHealth, anchor: input.topicAnchor });
  } catch (e) {
    return { ok: false, error: `Could not write the script (${e instanceof Error ? e.message.slice(0, 120) : "unknown error"}).` };
  }
}
