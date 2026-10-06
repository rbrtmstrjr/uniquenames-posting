import { NO_TEXT } from "@/lib/planner/prompt";
import { emotionOf, shotOf, type ReelEmotion, type ReelShot } from "./motion";
import { isDollTheme, KNIT_STYLE, type ReelTheme } from "./themes";

export { KNIT_STYLE };

// Z-Image runs at cfg 1 with no negative prompt: naming an unwanted thing summons it, so every
// line here only describes what should be in frame (NO_TEXT is the one proven exception).
// Never the word "camera"; framing is set with a lens line, as in the photoshoot planner.

/** The script's two recurring characters (stored as `reels.doll_cast`). */
export interface ReelCast { adult: string; child: string }

/** What scenePrompt needs from a line (emotion / action / shot are null on reels written before migration 007). */
export interface PromptScene {
  idea: string; beat?: string | null;
  emotion?: string | null; action?: string | null; shot?: string | null;
}

/** Lines written before 007 have no shot: the old lens choice (opening = medium full of emotion). */
const lensOld = (who: string, hook: boolean, beat?: string | null) =>
  hook ? `50mm lens at f/2.8, a medium shot full of strong emotion, the ${who} sharp`
    : beat === "close" ? `35mm lens at f/4, a warm medium-wide view, the ${who} sharp`
      : `35mm lens at f/4, the whole cozy setting in view, the ${who} sharp`;

/** The framing per shot, as a lens line (positive-only, never "camera"). */
export const SHOT_LENS: Record<ReelShot, (who: string) => string> = {
  wide: (who) => `24mm lens at f/5.6, a wide view of the whole setting, the ${who} clear and sharp within it`,
  medium: (who) => `50mm lens at f/2.8, a medium view of the ${who} from the waist up, the ${who} sharp`,
  "over-the-shoulder": () => "35mm lens at f/2.8, a view over the parent's shoulder toward the child, the shoulder soft in the foreground, the child sharp",
  "low-angle": (who) => `28mm lens at f/4, a low-angle view looking up at the ${who}, the ${who} sharp`,
  "hands-detail": () => "85mm lens at f/2.8, a close medium view centred on the hands and what they hold, the faces still in frame, the hands sharp",
  "eye-level": (who) => `35mm lens at f/4, an eye-level view at the child's height, the cozy setting around them, the ${who} sharp`,
};

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
    .replace(/\b(the|both|two|these|those) dolls\b/gi, (_, w: string) => `${w} ${w.toLowerCase() === "the" ? "characters" : "of them"}`)
    .replace(/(\w) doll(?:'s|’s)/gi, "$1's")
    .replace(/(\w) dolls?\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

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

/**
 * One line's image prompt: moment + feeling + lens first (order matters), then the theme's style, the cast,
 * composition, NO_TEXT. The feeling is a visible facial expression for themes with faces and body language only
 * for the others. Only the opening picture (index 0) gets the hook treatment.
 */
export function scenePrompt(theme: ReelTheme, cast: ReelCast, scene: PromptScene, index: number): string {
  const dolls = isDollTheme(theme);
  // Doll wording becomes people wording only when the cast was written as dolls (a Knitted Doll script).
  const people = !dolls && isDollCast(cast);
  const fix = (s: string | null | undefined, lift = dolls) => positiveOnly(people ? undoll(s ?? "") : (s ?? ""), lift);
  const who = dolls ? "dolls" : "characters";
  const hook = index === 0;
  const moment = hook ? "one striking, high-emotion moment" : "one tender moment";
  const emotion = emotionOf(scene.emotion);
  const action = fix(scene.action);
  // An idea with nothing left (every clause named something absent, or a knitted lift) falls back to a calm moment.
  const idea = fix(scene.idea) || (dolls ? "the two dolls cuddle close together" : "the two of them share a quiet, close moment");
  const feeling = !emotion ? "" : theme.faces
    ? ` Emotion: ${EMOTION_FACE[emotion]}.`
    : ` Feeling: ${emotion}, shown through pose: ${EMOTION_POSE[emotion]}.`;
  const body = action ? ` Body language: ${action}.` : "";
  const shot = shotOf(scene.shot);
  let lens = shot ? SHOT_LENS[shot](who) : lensOld(who, hook, scene.beat);
  if (hook && shot) lens += ", full of strong emotion";
  const characters = dolls ? "the same two dolls in every picture" : "the same two people in every picture";
  const set = dolls ? "the handmade set" : "the scene";
  return [
    `A single full-bleed vertical 9:16 picture of ${moment}. Moment: ${idea}.${feeling}${body} Lens: ${lens}.`,
    `${theme.style} Characters (${characters}): ${fix(cast.adult, false)}; ${fix(cast.child, false)}.${dolls ? ` ${KNIT_POSE}` : ""}`,
    `Composition: ${set} fills the whole frame edge to edge; the ${who} and their action sit in the upper and middle part of the frame, and the band just below the middle is calm and uncluttered — a soft, simple, evenly lit stretch of the scene's own floor, blanket or background.`,
    NO_TEXT,
  ].join("\n");
}
