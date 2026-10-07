import { NO_TEXT } from "@/lib/planner/prompt";
import type { ReelCast } from "@/lib/db/types";
import { emotionOf, shotOf, type ReelEmotion, type ReelShot } from "./motion";
import { hasFace, isFaceFree, sizeOf, subjectOf, type ReelShotSize, type ReelSubject } from "./shots";
import { isDollTheme, KNIT_STYLE, styleTag, type ReelTheme } from "./themes";

export { KNIT_STYLE };
export type { ReelCast };

// Z-Image runs at cfg 1 with no negative prompt: naming an unwanted thing summons it, so every
// line here only describes what should be in frame (NO_TEXT is the one proven exception).
// Never the word "camera"; framing is set with shot size + angle + lens words.
//
// Playbook v2 token order (front-loaded: the model weighs the first tokens most):
//   [shot size + angle + lens], [moment, body language, feeling], [character tag], [setting + time of day],
//   [lighting], [style tag]
// then NO_TEXT. Detail / B-roll / object / empty shots carry no face description (hands: skin tone + wardrobe only).

/** What scenePrompt needs from a line (the 007 / 008 fields are null on lines written before them). */
export interface PromptScene {
  idea: string; beat?: string | null;
  emotion?: string | null; action?: string | null;
  /** 007 framing (older lines only; mapped to a shot size). */
  shot?: string | null;
  /** 008: shot size + who is in frame. */
  shot_size?: string | null; subject?: string | null;
}

/**
 * The framings per shot size, each a [size + angle + lens] phrase; a line takes option (index mod count), so two lines
 * in a row never share the same lens + angle (every phrase is unique, and each size has at least 2).
 * Lenses: wide 24-35 mm, medium 50 mm, close 85 mm, detail 100 mm macro, POV 24 mm first-person, B-roll 50 mm.
 */
export const SHOT_FRAMES: Record<ReelShotSize, readonly string[]> = {
  wide: ["wide establishing shot at eye level, 24mm lens", "wide shot from a high angle, 35mm lens", "wide shot from a low angle, 28mm lens"],
  medium: ["medium shot at eye level, 50mm lens", "medium shot from a slightly high angle, 50mm lens", "medium shot from a low angle, 50mm lens"],
  close: ["close-up at eye level, 85mm lens, shallow focus", "close-up from a slightly high angle, 85mm lens, shallow focus", "close-up from a low angle, 85mm lens, shallow focus"],
  detail: ["extreme close-up detail from directly above, 100mm macro lens", "extreme close-up detail at eye level, 100mm macro lens", "extreme close-up detail from the side, 100mm macro lens"],
  pov: ["first-person point of view looking down, 24mm lens", "first-person point of view at arm's length, 24mm lens"],
  broll: ["quiet cutaway shot from directly above, 50mm lens", "quiet cutaway shot from a high angle, 50mm lens", "quiet cutaway shot from the side, 50mm lens"],
};
/**
 * The framings for pictures with nobody in them: optics without "lens" / "mm" words (with no people in frame, Z-Image
 * draws the named lens itself, e2e e76f1506). Same rotation; every phrase unique and distinct from SHOT_FRAMES.
 */
export const STILL_FRAMES: Record<ReelShotSize, readonly string[]> = {
  wide: ["wide view at eye level, deep focus", "wide view from a high angle, deep focus", "wide view from a low angle, deep focus"],
  medium: ["natural medium framing at eye level, soft background blur", "natural medium framing from a slightly high angle, soft background blur", "natural medium framing from a low angle, soft background blur"],
  close: ["close view at eye level, shallow depth of field, soft background blur", "close view from a slightly high angle, shallow depth of field, soft background blur", "close view from a low angle, shallow depth of field, soft background blur"],
  detail: ["macro close-up from directly above, very shallow depth of field, soft background blur", "macro close-up at eye level, very shallow depth of field, soft background blur", "macro close-up from the side, very shallow depth of field, soft background blur"],
  pov: ["first-person view looking down, soft background blur", "first-person view at arm's length, soft background blur"],
  broll: ["quiet cutaway view from directly above, soft background blur", "quiet cutaway view from a high angle, soft background blur", "quiet cutaway view from the side, soft background blur"],
};
/** A line's framing phrase (`still` = nobody in frame: no lens words). */
export const frameOf = (size: ReelShotSize, index: number, still = false) => {
  const f = (still ? STILL_FRAMES : SHOT_FRAMES)[size];
  return f[Math.max(0, index) % f.length];
};

/** Lines written before 008 carry a 007 framing (or none): the nearest shot size. */
const LEGACY_SIZE: Record<ReelShot, ReelShotSize> = {
  wide: "wide", medium: "medium", "over-the-shoulder": "medium", "low-angle": "medium", "hands-detail": "detail", "eye-level": "medium",
};

/** The light per feeling (warm for joy and comfort, cooler and dimmer for worry), when the setting names no time of day. */
export const EMOTION_LIGHT: Record<ReelEmotion, string> = {
  laughing: "bright warm light", playful: "bright cheerful light", surprised: "clear soft light",
  curious: "clear soft light with a gentle glow", determined: "warm golden backlight", proud: "warm golden backlight",
  relieved: "soft warm light", tender: "soft golden window light", cuddly: "soft golden lamp light",
  teary: "gentle dim light with a warm lamp glow", worried: "cool dim light with one warm lamp",
  exhausted: "cool dim light with one warm lamp",
};
/** Feelings that keep their cooler, dimmer light whatever the time of day. */
const LOW_MOODS: ReadonlySet<ReelEmotion> = new Set(["teary", "worried", "exhausted"]);
/** The setting's time of day wins over the feeling's light (no "bright daylight" in "the sala at night"). */
const TIME_LIGHT: [RegExp, string, string][] = [
  [/\b(?:night|midnight|\d+(?::\d+)?\s*a\.?\s?m\b|bedtime|dark|moonlight|lamp ?light)/i, "warm dim lamp light at night", "cool dim night light with one warm lamp"],
  [/\b(?:dusk|sunset|evening|twilight|golden hour)\b/i, "warm golden dusk light", "fading blue dusk light with a warm lamp"],
  [/\b(?:dawn|sunrise|early morning)\b/i, "soft pale dawn light", "cool pale dawn light"],
  [/\b(?:rain|rainy|raining|storm|stormy)\b/i, "soft grey rainy-day light with a warm lamp", "soft grey rainy-day light"],
  [/\b(?:morning|breakfast)\b/i, "fresh soft morning light", "pale soft morning light"],
  [/\b(?:noon|midday|afternoon|sunny|daytime|daylight)\b/i, "bright warm daylight", "soft hazy daylight"],
];
/** The lighting slot: the setting's time of day (with the feeling's warmth), else the feeling's own light. */
export function lightFor(emotion: ReelEmotion | null, setting: string): string {
  const low = !!emotion && LOW_MOODS.has(emotion);
  for (const [re, warm, cool] of TIME_LIGHT) if (re.test(setting)) return low ? cool : warm;
  return emotion ? EMOTION_LIGHT[emotion] : "soft warm light";
}

/** Separates the moment from its setting in a stored idea ("the mom kneels by the crib — the nursery at 3 a.m."). */
export const IDEA_SETTING_SEP = " — ";
const trimEnd = (s: string) => s.replace(/\s+/g, " ").trim().replace(/[\s.;,]+$/, "");
/** The stored idea: the moment, then (if any) its setting. */
export const joinIdea = (moment: string, setting?: string | null) =>
  trimEnd(setting ?? "") ? `${trimEnd(moment)}${IDEA_SETTING_SEP}${trimEnd(setting!)}` : trimEnd(moment);
/** A stored idea back into its moment and setting (an idea without the separator is all moment). */
export function splitIdea(idea: string): { moment: string; setting: string } {
  const s = (idea ?? "").replace(/\s+/g, " ").trim();
  const at = s.lastIndexOf(IDEA_SETTING_SEP.trim());
  if (at <= 0) return { moment: trimEnd(s), setting: "" };
  return { moment: trimEnd(s.slice(0, at)), setting: trimEnd(s.slice(at + 1)) };
}

const wordsOf = (s: string) => s.split(" ").filter(Boolean);
const DANGLING = /(?:\s+(?:a|an|the|in|on|with|of|and|or|at|to|by|for|her|his|their))+$/i;
/** At most n words, cut at the last comma inside them when that keeps 3+ words (never ending on "in a"). */
export function capWords(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  const w = wordsOf(t);
  if (w.length <= n) return trimEnd(t);
  const head = w.slice(0, n).join(" ");
  const comma = head.lastIndexOf(",");
  return trimEnd(trimEnd(comma > 0 && wordsOf(head.slice(0, comma)).length >= 3 ? head.slice(0, comma) : head).replace(DANGLING, ""));
}
/** Longest character tag (one person); two people stay within ~15 words. */
export const TAG_MAX_WORDS = 8;
/**
 * A cast member's short tag: the script's own, else the description after its name, cut to TAG_MAX_WORDS (`map`, e.g.
 * undoll, runs before the cut so it sees whole phrases).
 */
export function castTag(cast: ReelCast, who: "adult" | "child", map: (s: string) => string = (s) => s): string {
  const own = map((who === "adult" ? cast.adult_tag : cast.child_tag) ?? "");
  if (own.trim()) return capWords(own, TAG_MAX_WORDS);
  const full = map((who === "adult" ? cast.adult : cast.child) ?? "");
  const at = full.indexOf(":");
  return capWords(at >= 0 ? full.slice(at + 1) : full, TAG_MAX_WORDS);
}
const IDENTITY = /\b(?:mom|mother|mama|dad|father|papa|parent|baby|toddler|newborn|infant|boy|girl|child|kid|preschooler|years?|months?|old|hair|bun|ponytail|braids?|curls?|curly|tufts?|bald|eyes?|face|smile|cheeks?|lashes|brows?|eyebrows?|freckles?|beard|glasses|young|filipin[oa]|doll|head|nose|mouth)\b/i;
/** Skin tone + wardrobe from a tag, for hands-only shots ("young mom, warm tan skin, low bun, mustard cardigan" → "warm tan skin, mustard cardigan"). */
export function wardrobeCue(tag: string): string {
  return tag.split(",").map((x) => x.trim()).filter((x) => x && (/\bskin\b/i.test(x) || !IDENTITY.test(x))).join(", ");
}

/** A feeling as a visible facial expression (themes with expressive faces). */
export const EMOTION_FACE: Record<ReelEmotion, string> = {
  laughing: "laughing, eyes squeezed into happy crescents, mouths wide open in delight",
  playful: "playful, wide cheeky grins, bright sparkling eyes, eyebrows raised in fun",
  surprised: "surprised, eyebrows high, eyes wide, mouths open round in wonder",
  curious: "curious, heads tilted, eyes wide and bright, small wondering smiles",
  determined: "determined, brows set, lips pressed into a firm brave smile, eyes focused",
  proud: "proud, chins up, beaming wide smiles, shining eyes",
  relieved: "relieved, eyes softly closed, long easy smiles, faces calm and loose",
  tender: "tender, a soft loving gaze, gentle small smiles",
  cuddly: "cozy and content, eyes half closed, cheeks pressed together, sleepy smiles",
  teary: "teary, inner brows lifted, glistening eyes with a visible tear, a soft trembling smile",
  worried: "worried, brows drawn together, lips pressed tight, eyes searching",
  exhausted: "exhausted, heavy-lidded tired eyes, a weary half smile",
};

/** A feeling as body language only (themes whose faces stay fixed: knitted, papercraft). */
export const EMOTION_POSE: Record<ReelEmotion, string> = {
  laughing: "bodies tipped back with joy, arms flung wide",
  playful: "bouncy and mid-play, arms reaching out to each other",
  surprised: "leaning back all of a sudden, hands up at the cheeks",
  curious: "leaning forward, heads tilted toward what they are looking at",
  determined: "standing tall, chest forward, one hand in a small brave fist",
  proud: "standing upright, chest high, arms open wide",
  relieved: "shoulders dropped, leaning back softly, a hand resting on the chest",
  tender: "leaning in close, heads gently tipped toward each other",
  cuddly: "wrapped in a snug hug, cheek against cheek",
  teary: "heads bowed close together, holding each other near, a hand over the heart",
  worried: "hunched forward, hands clasped tight, leaning close to the child",
  exhausted: "slumped low on the seat, head resting back, arms heavy and still",
};

/** A feeling as body language for ONE person in frame (mom or baby alone). */
export const EMOTION_POSE_ONE: Record<ReelEmotion, string> = {
  laughing: "body tipped back with joy, arms flung wide",
  playful: "bouncy and mid-play, arms out wide",
  surprised: "leaning back all of a sudden, hands up at the cheeks",
  curious: "leaning forward, head tilted toward what is in view",
  determined: "standing tall, chest forward, one hand in a small brave fist",
  proud: "standing upright, chest high, arms open wide",
  relieved: "shoulders dropped, leaning back softly, a hand resting on the chest",
  tender: "head gently tipped, hands soft and open",
  cuddly: "curled up snug and cozy",
  teary: "head bowed, a hand over the heart",
  worried: "hunched forward, hands clasped tight",
  exhausted: "slumped low, head resting back, arms heavy and still",
};

/** Knitted dolls: a lifted baby doll turns into two babies (spike), so the dolls stay grounded (positive wording). */
export const KNIT_POSE =
  "Both dolls stay close and grounded: sitting, standing, kneeling or cuddling together, the child doll held snugly against the chest or resting in a lap, on a blanket or on the floor.";

const clean = (s: string) => s.replace(/\s+/g, " ").trim().replace(/[\s.;,]+$/, "");

/**
 * Doll wording → people wording, for themes that are not Knitted Doll ("the mom doll: a crocheted mother doll with
 * yarn hair, warm tan wool skin" → "the mom: a mother with hair, warm tan skin"). The stored cast and ideas keep
 * their words, so switching back to Knitted Doll gives the original prompt again.
 */
export function undoll(s: string): string {
  return s
    .replace(/\b(?:crocheted|crochet|amigurumi|knitted|handmade|stitched|embroidered)\s+(?=[a-z])/gi, "")
    .replace(/\bbead eyes\b/gi, "eyes")
    .replace(/\b(?:yarn|wool|woollen|woolen)\s+(?=(?:hair|skin|tufts?|curls?|strands?|braids?|ponytails?|eyebrows?|lashes|fringe)\b)/gi, "")
    // doll materials used for bodies or toys ("tiny yarn feet" → "tiny feet", "yarn toy blocks" → "toy blocks")
    .replace(/\b(?:yarn|wool|woollen|woolen|felt)\s+(?=(?:feet|foot|toes?|hands?|fingers?|arms?|legs?|cheeks?|body|bodies|head|heads|face|faces|tummy|belly|nose|ears?|lips|mouth|limbs?|toys?|blocks?|balls?|bears?|bunn(?:y|ies)|animals?|rattles?)\b)/gi, "")
    .replace(/\b(the|both|two|these|those) dolls\b/gi, (_, w: string) => `${w} ${w.toLowerCase() === "the" ? "characters" : "of them"}`)
    .replace(/(\w) doll(?:'s|’s)/gi, "$1's")
    .replace(/(\w) dolls?\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const AGE_RE = /\b(?:a |an )?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen)[- ](?:week|month|year)s?[- ]old(?:[- ](?:baby|newborn|toddler|boy|girl|child|kid))*(?: (?:boy|girl))?/i;
const STAGE_AGE: Record<string, string> = { newborn: "a newborn baby", baby: "a baby", toddler: "a toddler", preschooler: "a preschool-age child" };
/** The child's age phrase: the script's own, else one found in the child's description ("six-month-old baby"), else the stage's. */
export function childAge(cast: ReelCast, stage?: string | null): string {
  const own = (cast.child_age ?? "").trim();
  if (own) return capWords(own, 6);
  const m = (cast.child ?? "").match(AGE_RE);
  if (m) return m[0].trim();
  return (stage && STAGE_AGE[stage]) || "";
}
/** The child's noun for "who is in the picture" (newborn / baby / toddler / child), from the age phrase. */
export function childNoun(age: string): string {
  if (/newborn|\b(?:\d|one|two|three|four)[- ]weeks?\b/i.test(age)) return "newborn";
  if (/toddler|\b(?:1|2|one|two|eighteen|1[2-9]|2\d)[- ](?:year|month)/i.test(age) && !/\b(?:[1-9]|1[01]|one|two|three|four|five|six|seven|eight|nine|ten|eleven)[- ]months?\b/i.test(age)) return "toddler";
  if (/\b(?:3|4|5|three|four|five)[- ]years?|preschool|child/i.test(age)) return "child";
  return "baby";
}
const WHO_WORD = /\b(?:baby|babies|newborn|infant|toddler|boy|girl|child|kid|preschooler|son|daughter|doll)\b/i;
/** The child's tag with its age first: the tag's own who-fragment ("chubby baby") gives way to the age phrase. */
export function childTagWithAge(tag: string, age: string): string {
  if (!age) return tag;
  const parts = tag.split(",").map((x) => x.trim()).filter(Boolean);
  const rest = parts.length && WHO_WORD.test(parts[0]) ? parts.slice(1) : parts;
  return [age, ...rest].join(", ");
}

/** Comma fragments of `b` that `a` already has are dropped ("tan skin, rust shorts" after "…, tan skin, …" → "rust shorts"). */
export function dedupeFragments(a: string, b: string): string {
  const key = (x: string) => x.trim().toLowerCase();
  const seen = new Set(a.split(",").map(key).filter(Boolean));
  return b.split(",").map((x) => x.trim()).filter((x) => x && !seen.has(key(x))).join(", ");
}
/** Each fragment once, in order. */
const uniqueFragments = (s: string) =>
  s.split(",").map((x) => x.trim()).filter((x, i, all) => x && all.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).join(", ");

/** A cast written as dolls (a Knitted Doll script): only then does another theme turn it into people. */
export const isDollCast = (cast: ReelCast) => /\b(?:dolls?|crochet(?:ed)?|amigurumi|yarn)\b/i.test(`${cast.adult} ${cast.child}`);

const NEGATION = /\b(?:no|not|never|without|avoid|don't|doesn't|isn't|aren't|nobody|nothing)\b/i;
/** Knitted Doll: a lifted / raised / tossed / held-up baby doll comes out as two babies (spike). */
const LIFT = /\b(?:lift(?:s|ed|ing)?|rais(?:e|es|ed|ing)|toss(?:es|ed|ing)?|hoist(?:s|ed|ing)?|up in the air|overhead|held up|holds? (?:\w+ ){0,3}up|holding (?:\w+ ){0,3}up)\b/i;

/**
 * Z-Image at cfg 1 draws whatever is named, so free text from the script (idea, action, cast) loses every clause that
 * names something absent ("no tears, smiling" → "smiling"); a leftover "camera" becomes "viewer". For Knitted Doll
 * (`dolls`) clauses that lift, raise, toss or hold the child up are dropped too. Clauses split on , ; and sentence ends.
 */
export function positiveOnly(s: string, dolls = false): string {
  const t = s.replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const kept = t.split(/(?<=[,;.!?])\s+/).filter((c) => !NEGATION.test(c) && !(dolls && LIFT.test(c)));
  return clean(kept.join(" ").replace(/\bcamera\b/gi, "viewer"));
}

/** The opening picture carries the hook card up top: that band stays calm so the card never covers a face (positive wording). */
export const HOOK_ROOM =
  "Composition: the top quarter of the frame is calm and simple, a soft stretch of the scene's own background; the faces and the action sit in the lower three quarters of the frame.";

/**
 * Who is in the picture, said positively (naming "nobody else" would summon strangers at cfg 1): both → "the only
 * people in the picture are the mom and her baby"; one → "the mom is the only person in the picture"; hands-only shots
 * say so; object / none → the still-life wording of the moment slot already describes a people-free picture.
 */
export function onlyLine(subject: ReelSubject, faceFree: boolean, parent: string, child: string, dolls = false): string {
  const p = dolls ? `${parent} doll` : parent, c = dolls ? `${child} doll` : child;
  const hands = faceFree ? ", seen only as their hands" : "";
  if (subject === "both") return `The only ${dolls ? "figures" : "people"} in the picture are the ${p} and her ${c}${hands}.`.replace("and her", parent === "dad" ? "and his" : "and her");
  if (subject === "mom") return `The ${p} is the only ${dolls ? "figure" : "person"} in the picture${faceFree ? ", seen only as her hands" : ""}.`.replace("her hands", parent === "dad" ? "his hands" : "her hands");
  if (subject === "baby") return `The ${c} is the only ${dolls ? "figure" : "person"} in the picture${faceFree ? ", seen only as small hands" : ""}.`;
  return "";
}

const HANDS: Record<"mom" | "baby" | "both", string> = {
  mom: "the parent's hands", baby: "the child's small hands", both: "the parent's and the child's hands",
};

/**
 * One line's image prompt (playbook v2), front-loaded:
 * `[shot size + angle + lens], [moment, body language, feeling], [character tag], [setting], [lighting], [style tag]`,
 * then NO_TEXT on its own line. Faces themes show the feeling on faces in medium / close / POV shots and through pose
 * in wide shots; faceless themes (knitted, papercraft) always through pose. Detail / B-roll / object / empty shots
 * carry no face: a person there is only their hands (skin tone + wardrobe). Only the opening picture (index 0) gets
 * the hook treatment. Lines from before 008 map their 007 framing to a size and show both characters.
 */
/** The parent's noun for "who is in the picture" (mom unless the cast is a dad). */
const parentNoun = (cast: ReelCast) => (/\b(?:dad|father|papa|tatay)\b/i.test(`${cast.adult_tag ?? ""} ${cast.adult}`) ? "dad" : "mom");

export function scenePrompt(theme: ReelTheme, cast: ReelCast, scene: PromptScene, index: number): string {
  const dolls = isDollTheme(theme);
  // Doll wording becomes people wording only when the cast was written as dolls (a Knitted Doll script).
  const people = !dolls && isDollCast(cast);
  const fix = (s: string | null | undefined, lift = dolls) => positiveOnly(people ? undoll(s ?? "") : (s ?? ""), lift);
  const age = positiveOnly(people ? undoll(childAge(cast)) : childAge(cast));
  const tag = (who: "adult" | "child") => {
    const t = positiveOnly(castTag(cast, who, people ? undoll : undefined));
    return who === "child" ? childTagWithAge(t, age) : t;
  };
  const legacy = shotOf(scene.shot);
  const size: ReelShotSize = sizeOf(scene.shot_size) ?? (legacy ? LEGACY_SIZE[legacy] : "medium");
  const subject: ReelSubject = subjectOf(scene.subject) ?? (size === "broll" ? "none" : "both");
  const person = hasFace(subject);
  const faceFree = isFaceFree({ shot_size: size, subject });
  const emotion = emotionOf(scene.emotion);
  const { moment: rawMoment, setting: rawSetting } = splitIdea(scene.idea);
  // An idea with nothing left (every clause named something absent, or a knitted lift) falls back to a calm moment.
  const fallback = !person ? "a quiet, cozy still moment"
    : dolls ? "the two dolls cuddle close together" : "the two of them share a quiet, close moment";
  const moment = fix(rawMoment) || fallback;
  const action = person ? fix(scene.action) : "";
  const feeling = !emotion || faceFree ? ""
    // faces themes: a line with its own action gets only the facial wording (a pose could contradict the action);
    // without an action, a wide shot shows the feeling through pose. Faceless themes: pose is the only channel.
    : theme.faces && (action || size !== "wide") ? EMOTION_FACE[emotion] : (subject === "both" ? EMOTION_POSE : EMOTION_POSE_ONE)[emotion];

  let who = "";
  if (person && faceFree) {
    const tags = [subject !== "baby" ? tag("adult") : "", subject !== "mom" ? tag("child") : ""].filter(Boolean);
    const cue = uniqueFragments(wardrobeCue(tags.join(", ")));
    who = `${HANDS[subject as "mom" | "baby" | "both"]}${cue ? `, ${cue}` : ""}`;
  } else if (person) {
    const a = tag("adult"), c = tag("child");
    const c2 = dedupeFragments(a, c);
    who = subject === "mom" ? a : subject === "baby" ? c : c2 ? `${a} with ${c2}` : a;
  }
  const setting = fix(rawSetting);
  const still = moment.replace(/^(A|An|The|One|Some|Two|Three)\b/, (w) => w.toLowerCase());
  const shown = !person ? `a quiet still life, ${still}, a calm, peaceful space` : index === 0 ? `a striking, high-emotion moment: ${moment}` : moment;
  const slots = [
    `Vertical 9:16 ${frameOf(size, index, !person)}`,
    [shown, action, feeling].filter(Boolean).join(", "),
    who,
    setting,
    lightFor(emotion, setting),
    styleTag(theme, !person),
  ].filter(Boolean);
  const only = onlyLine(subject, faceFree, parentNoun(cast), childNoun(age), dolls);
  const pose = dolls && subject === "both" && !faceFree ? ` ${KNIT_POSE}` : "";
  const room = index === 0 ? ` ${HOOK_ROOM}` : "";
  return `${slots.join(", ")}.${only ? ` ${only}` : ""}${pose}${room}\n${NO_TEXT}`;
}
