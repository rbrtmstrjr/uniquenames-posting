import { GUIDE_THEME_IDS, REEL_THREADS, type GuideThemeId, type ReelCast, type ReelThread } from "@/lib/db/types";
import { CRAYON_GUIDE, CRAYON_PREVIEW_SCENE, ONLY_RED, PHONE_VISIBLE, RED_THREAD_GUIDE, RED_THREAD_PREVIEW } from "./guide-text";
import { emotionOf, type ReelEmotion } from "./motion";
import { castTag, childAge, childNoun, isDollCast, positiveOnly, scrubOptics, splitIdea, undoll, wardrobeCue, type PromptScene } from "./prompt";
import { hasFace, isFaceFree, sizeOf, subjectOf, type ReelShotSize, type ReelSubject } from "./shots";

// The two reel styles of migration 012, built from the owner's guides (lib/reels/guide-text.ts). The master prompt
// stays verbatim and in the guide's order (style, depth, [SCENE] (+ [THREAD] + "The feeling is …."), closing);
// only the scene, thread and feeling slots change per picture. Pure and deterministic.

export { REEL_THREADS };
export type { ReelThread };

export const isGuideThemeId = (x: unknown): x is GuideThemeId =>
  typeof x === "string" && (GUIDE_THEME_IDS as readonly string[]).includes(x);
/** Crayon or Red Thread: the image prompt follows an owner guide instead of the playbook's token order. */
export const isGuideTheme = (t: { id?: unknown } | null | undefined) => isGuideThemeId(t?.id);

// ---------------------------------------------------------------- the master prompts

/** Crayon: style, depth, [SCENE] (ending "The feeling is …."), closing. */
export function crayonPrompt(sceneWithFeeling: string): string {
  return [CRAYON_GUIDE.style, CRAYON_GUIDE.depth, sceneWithFeeling.trim(), CRAYON_GUIDE.close].join("\n\n");
}

/**
 * Red Thread: style, depth, [SCENE] / [THREAD] / "The feeling is …." on their own lines, closing; "the red thread is
 * the only color in the image" repeated at the very start and end (guide quick fix). `threadFirst` puts the thread line
 * before the scene (guide quick fix for both wrists, line A).
 */
export function redThreadPrompt(scene: string, thread: string, feeling: string, threadFirst = false): string {
  const lines = threadFirst ? [thread.trim(), scene.trim()] : [scene.trim(), thread.trim()];
  const block = [...lines, `The feeling is ${feeling}.`].join("\n");
  return [`${ONLY_RED} ${RED_THREAD_GUIDE.style}`, RED_THREAD_GUIDE.depth, block, `${RED_THREAD_GUIDE.close} ${ONLY_RED}`].join("\n\n");
}

/** A guide thread line with the "thick enough to be clearly visible on a phone screen" quick fix. */
export const withPhoneFix = (line: string) =>
  line.replace(/^A clearly visible thin bright red thread /, `A clearly visible thin bright red thread, ${PHONE_VISIBLE}, `);

/** The preview prompt of a guide style: Crayon's "Mother and newborn", Red Thread's "2. Newborn" (thread first). */
export function guidePreviewPrompt(id: GuideThemeId): string {
  if (id === "crayon") return crayonPrompt(CRAYON_PREVIEW_SCENE);
  return redThreadPrompt(RED_THREAD_PREVIEW.scene, withPhoneFix(RED_THREAD_PREVIEW.thread), RED_THREAD_PREVIEW.feeling, true);
}

// ---------------------------------------------------------------- Red Thread: the thread line

const OPEN = `A clearly visible thin bright red thread, ${PHONE_VISIBLE},`;
const AS_IF = "as if connected to someone not in the picture.";
/** Which side a lone thread leaves the frame (guide: "match direction across cuts"). */
export type ThreadSide = "right" | "left";
const away = (side: ThreadSide | null) => side
  ? `stretching away across the floor to the ${side} and leading out of the ${side} side of the frame`
  : "stretching away across the floor and leading out of the frame";
const leave = (side: ThreadSide | null) => (side ? `leading out of the ${side} side of the frame` : "leading out of the frame");

/** Line A (both visible): what the one continuous thread does between the two wrists, per thread state. */
const BOTH_TAIL: Record<ReelThread, string> = {
  plain: "one continuous thread connecting both wrists, looping loosely around them, with a short end trailing gently onto the floor.",
  tight: "one continuous thread connecting both wrists, the thread pulled short and tight between them in a small close loop.",
  stretched: "one long continuous thread stretching across the floor between them, still connected.",
  tangled: "one continuous thread connecting both wrists, the thread loosely tangled in a messy knot between them, but still connected.",
  loose: "one continuous thread connecting both wrists, hanging long and loose between them and resting on the floor, but still tied.",
};
/** Lines B / C (one person): where the other end goes, per thread state. */
const ONE_TAIL: Record<ReelThread, (side: ThreadSide | null) => string> = {
  plain: (s) => `with the other end ${away(s)}, ${AS_IF}`,
  tight: (s) => `with the other end pulled taut, ${away(s)}, ${AS_IF}`,
  stretched: (s) => `with the other end stretching far away, long and taut, across the floor${s ? ` to the ${s}` : ""} and ${leave(s)}, ${AS_IF}`,
  tangled: (s) => `with the other end tangled in a loose knot on the floor, then ${away(s)}, ${AS_IF}`,
  loose: (s) => `with the other end lying long and loose across the floor, still tied, and ${leave(s)}, ${AS_IF}`,
};

export interface ThreadWho {
  /** both = line A, parent = line B, child = line C, none = nobody in the picture (the thread rests on the objects). */
  kind: "both" | "parent" | "child" | "none";
  /** The cast words that replace "parent" / "child" (mother, father / baby, boy, girl, child). */
  parent: string; child: string;
  /** A baby's or newborn's "tiny wrist" (guide example 2). */
  tiny?: boolean;
}

/**
 * The [THREAD] line. Without the phone fix and with the plain words ("parent" / "child", no side) it is the guide's own
 * line A / B / C, verbatim. Lone threads leave the frame on a fixed side: the parent's to the right, the child's to the
 * left, so the thread matches across cuts.
 */
export function threadLine(who: ThreadWho, state: ReelThread = "plain", opts: { phone?: boolean; side?: boolean } = {}): string {
  const phone = opts.phone ?? true, sides = opts.side ?? true;
  const open = phone ? OPEN : "A clearly visible thin bright red thread";
  const wrist = who.tiny ? "tiny wrist" : "wrist";
  if (who.kind === "both") return `${open} is tied in a small bow around the ${who.parent}'s wrist and tied around the ${who.child}'s ${wrist}, ${BOTH_TAIL[state]}`;
  if (who.kind === "parent") return `${open} is tied in a small bow around the ${who.parent}'s wrist, ${ONE_TAIL[state](sides ? "right" : null)}`;
  if (who.kind === "child") return `${open} is tied in a small bow around the ${who.child}'s ${wrist}, ${ONE_TAIL[state](sides ? "left" : null)}`;
  return `${open} rests on the floor and drapes across the things in the picture, with one end trailing away and leading out of the frame, as if connecting two people not in the picture.`;
}

const THREAD_ALIASES: Record<string, ReelThread> = {
  plain: "plain", normal: "plain", calm: "plain", default: "plain",
  tight: "tight", short: "tight", close: "tight", "tight-loop": "tight",
  stretched: "stretched", long: "stretched", stretch: "stretched", distance: "stretched", far: "stretched",
  tangled: "tangled", tangle: "tangled", knotted: "tangled", knot: "tangled",
  loose: "loose", slack: "loose", "loose-but-tied": "loose",
};
/** "Tight" / "long stretched" / "tangled" → the thread state, or null. */
export function threadOf(x: unknown): ReelThread | null {
  if (typeof x !== "string") return null;
  const k = x.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return THREAD_ALIASES[k] ?? THREAD_ALIASES[k.split("-")[0]] ?? null;
}

/** When the script gave no thread: hugs and cuddles pull it tight, hard moments leave it loose but tied. */
export const THREAD_FOR_EMOTION: Record<ReelEmotion, ReelThread> = {
  laughing: "plain", playful: "plain", surprised: "plain", curious: "plain", determined: "plain", proud: "plain",
  relieved: "plain", tender: "plain", cuddly: "tight", teary: "loose", worried: "loose", exhausted: "loose",
};
export const threadFor = (thread: unknown, emotion: unknown): ReelThread =>
  threadOf(thread) ?? THREAD_FOR_EMOTION[emotionOf(emotion) ?? "tender"];

// ---------------------------------------------------------------- the feeling

/** When the script gave no feeling phrase: one per emotion, in the guides' own register. */
export const FEELING_FOR_EMOTION: Record<ReelEmotion, string> = {
  laughing: "pure joy", playful: "playful joy", surprised: "happy wonder", curious: "wonder and discovery",
  determined: "quiet strength", proud: "pride and joy", relieved: "relief after a long day", tender: "pure love and warmth",
  cuddly: "warm closeness", teary: "a love that aches", worried: "worry wrapped in love", exhausted: "tired but full of love",
};
export const FEELING_MAX_WORDS = 10;
/** "The feeling is pure love." / "Pure love!" → "pure love"; '' when nothing usable is left. */
export function cleanFeeling(x: unknown): string {
  if (typeof x !== "string") return "";
  const t = x.replace(/\s+/g, " ").trim()
    .replace(/^the feeling (?:here )?is\s*:?\s*/i, "")
    .replace(/\bcamera\b/gi, "")
    .replace(/[\s.!?;:,]+$/, "").trim();
  if (!t) return "";
  const w = t.split(" ");
  const cut = w.length > FEELING_MAX_WORDS ? w.slice(0, FEELING_MAX_WORDS).join(" ").replace(/[\s,;]+$/, "") : t;
  return /^I\b/.test(cut) ? cut : cut[0].toLowerCase() + cut.slice(1);
}
export const feelingFor = (feeling: unknown, emotion: unknown): string =>
  cleanFeeling(feeling) || FEELING_FOR_EMOTION[emotionOf(emotion) ?? "tender"];

// ---------------------------------------------------------------- the scene text

/** Red-family colour words (Red Thread: only the thread may be red; Z-Image keeps what is named). */
const RED_WORDS = /\b(?:(?:bright|deep|dark|light|pale|soft|warm|vivid|bold|rich|dusty)[ -])?(?:red|reddish|rosy|crimson|scarlet|maroon|burgundy|ruby|cherry|pink|pinkish|coral|rust|magenta|wine|colou?rful|multicolou?red)(?:-colou?red)?\b[ -]?/gi;
/** Drops red-family colour words ("a rosy blanket, red shoes" → "a blanket, shoes"). */
export function greyText(s: string): string {
  return s.replace(RED_WORDS, "").replace(/\s+([,.;])/g, "$1").replace(/\s{2,}/g, " ").trim()
    .replace(/([.!?]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

const LOOK_AT_VIEWER = /\b(look(?:s|ing)?|gaz(?:e|es|ing)|smil(?:e|es|ing)|star(?:e|es|ing)|glanc(?:e|es|ing))\s+(?:straight |directly )?(?:at|toward|towards|into)\s+(?:the |a )?(?:camera|viewer|lens)\b/gi;
const FRAMING_LEAD = /^(?:an? )?(?:(?:extreme|very|quiet|soft) )?(?:wide|medium|close|close-up|closeup|detail|macro|still|establishing|full|overhead)(?:[ -](?:up|detail|still|establishing|shot))*\s+(?:view|shot|framing)\b(?:\s+of)?\s*[:,.]?\s*/i;
const FEELING_SENTENCE = /\s*\bthe feeling (?:here )?is\b([^.!?]*)[.!?]?/i;
const THREAD_WORDS = /\b(?:thread|threads|string|ribbon|yarn|cord)\b/i;

/**
 * A script's [SCENE] text, cleaned for the guide styles: no framing words (the builder adds the shot), no "The
 * feeling is …" (its own slot; returned as `feeling`), looks at the viewer turned to each other, clauses naming
 * something absent dropped, no camera / lens / mm words. Red Thread also loses any sentence about the thread (its own
 * line) and every red-family colour.
 */
export function cleanScene(raw: unknown, opts: { red?: boolean; both?: boolean } = {}): { scene: string; feeling: string } {
  let s = typeof raw === "string" ? raw.replace(/[’]/g, "'").replace(/\s+—\s+/g, ", ").replace(/\s+/g, " ").trim() : "";
  const f = s.match(FEELING_SENTENCE);
  const feeling = f ? cleanFeeling(f[1]) : "";
  s = s.replace(new RegExp(FEELING_SENTENCE.source, "gi"), " ").trim();
  s = s.replace(FRAMING_LEAD, "");
  // two people look at each other (guide rule); one person's look at the viewer is dropped (the clause is negated so
  // positiveOnly removes it)
  s = s.replace(LOOK_AT_VIEWER, (_m, verb: string) => (opts.both ? `${verb} at each other` : "not"));
  // sentence by sentence, so a dropped clause never glues two sentences together
  const out = s.split(/(?<=[.!?])\s+/)
    .filter((x) => !(opts.red && THREAD_WORDS.test(x)))
    .map((x) => {
      let t = scrubOptics(positiveOnly(x));
      if (opts.red) t = greyText(t);
      t = t.replace(/^[,;.\s]+/, "").replace(/[\s,;]+$/, "").trim();
      return t ? `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}` : "";
    })
    .filter(Boolean).join(" ");
  return { scene: out, feeling };
}

// ---------------------------------------------------------------- one picture

/** The shot, in plain words (no lens or mm words in these styles). [person, nobody in the picture]. */
export const GUIDE_LEAD: Record<ReelShotSize, readonly [string, string]> = {
  wide: ["A wide view of the whole place.", "A wide view of the whole place."],
  medium: ["A medium view of the characters from the waist up.", "A medium view of the objects."],
  close: ["A close view of the faces.", "A close view of the objects."],
  detail: ["A very close detail view of the hands.", "A very close detail view of the objects."],
  pov: ["Seen through the PARENT's own eyes, looking down.", "Seen through the PARENT's own eyes, looking down."],
  broll: ["A quiet view of the place.", "A quiet still view of the place."],
};
/** Line 1 carries the hook card up top: that band stays calm. */
export const GUIDE_HOOK_ROOM = "The top quarter of the picture is calm, simple background.";

/** Each comma fragment once, in order. */
const uniqueFragments = (s: string) =>
  s.split(",").map((x) => x.trim()).filter((x, i, all) => x && all.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).join(", ");
const sentence = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim().replace(/[\s,;]+$/, "");
  return t ? (/[.!?]$/.test(t) ? t : `${t}.`) : "";
};

/** The parent's word: father for a dad cast, else mother. */
export const parentWord = (cast: ReelCast) =>
  /\b(?:dad|father|papa|tatay|daddy)\b/i.test(`${cast.adult_tag ?? ""} ${cast.adult}`) ? "father" : "mother";
/** The child's word: baby for a newborn / baby, else boy / girl from the cast, else child. */
export function childWord(cast: ReelCast): { word: string; tiny: boolean } {
  const noun = childNoun(childAge(cast));
  if (noun === "newborn" || noun === "baby") return { word: "baby", tiny: true };
  const text = `${cast.child_age ?? ""} ${cast.child_tag ?? ""} ${cast.child}`;
  if (/\b(?:girl|daughter)\b/i.test(text)) return { word: "girl", tiny: false };
  if (/\b(?:boy|son)\b/i.test(text)) return { word: "boy", tiny: false };
  return { word: "child", tiny: false };
}

/** "The mother is a young Filipino mother with …." from the cast's description (the part after its name). */
function castSentence(cast: ReelCast, who: "adult" | "child", word: string, fix: (s: string) => string): string {
  const full = fix(who === "adult" ? cast.adult : cast.child);
  const at = full.indexOf(":");
  let desc = (at >= 0 ? full.slice(at + 1) : full).trim().replace(/[\s.;,]+$/, "");
  if (who === "child") {
    const age = fix(childAge(cast));
    if (age && !/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen)[- ](?:week|month|year)s?[- ]old\b|\bnewborn\b/i.test(desc)) {
      desc = desc ? `${age}, ${desc.replace(/^(?:a|an|the)\s+/i, "")}` : age;
    }
  }
  if (!desc) return "";
  return /^(?:a|an)\b/i.test(desc) ? `The ${word} is ${desc}.` : `The ${word}: ${desc}.`;
}

/** What a guide style's picture needs from a line: the stored scene (idea), shot, and the 012 feeling + thread. */
export interface GuideScene extends PromptScene {
  feeling?: string | null;
  thread?: string | null;
}

/**
 * One line's image prompt in a guide style. [SCENE] = the shot in plain words (+ the hook band on line 1), the
 * script's scene, then who the characters are (the same cast sentence in every picture, so they stay the same
 * people); Crayon ends it with "The feeling is …."; Red Thread adds the thread line (line A first when both are in
 * the picture; the thread rests on the objects when nobody is) and the feeling on its own line.
 */
export function guideScenePrompt(theme: { id: GuideThemeId }, cast: ReelCast, scene: GuideScene, index: number): string {
  const red = theme.id === "redthread";
  const people = isDollCast(cast);
  const fix = (s: string | null | undefined) => {
    const t = positiveOnly(people ? undoll(s ?? "") : (s ?? ""));
    return red ? greyText(t) : t;
  };
  const size: ReelShotSize = sizeOf(scene.shot_size) ?? "medium";
  const subject: ReelSubject = subjectOf(scene.subject) ?? (size === "broll" ? "none" : "both");
  const person = hasFace(subject);
  const faceFree = isFaceFree({ shot_size: size, subject });
  const pw = parentWord(cast), cw = childWord(cast);

  const { moment, setting } = splitIdea(people ? undoll(scene.idea ?? "") : (scene.idea ?? ""));
  const text = cleanScene(setting ? `${moment}, ${setting}` : moment, { red, both: subject === "both" });
  const body = text.scene || (person ? `The ${pw} and the ${cw.word} share a quiet, close moment.` : "A quiet, cozy still moment.");
  const feeling = feelingFor(scene.feeling || text.feeling, scene.emotion);

  const lead = GUIDE_LEAD[size][person ? 0 : 1].replace("PARENT", pw);
  let who: string[] = [];
  if (person && faceFree) {
    const tags = [subject !== "baby" ? castTag(cast, "adult", people ? undoll : undefined) : "", subject !== "mom" ? castTag(cast, "child", people ? undoll : undefined) : ""];
    const cue = fix(uniqueFragments(wardrobeCue(tags.filter(Boolean).join(", "))));
    who = [cue ? `Only the hands are shown: ${cue}.` : ""];
  } else if (person) {
    who = [subject !== "baby" ? castSentence(cast, "adult", pw, fix) : "", subject !== "mom" ? castSentence(cast, "child", cw.word, fix) : ""];
  }
  const sceneText = [lead, index === 0 ? GUIDE_HOOK_ROOM : "", body, ...who].filter(Boolean).map(sentence).join(" ");

  if (!red) return crayonPrompt(`${sceneText} The feeling is ${feeling}.`);
  const kind: ThreadWho["kind"] = subject === "both" ? "both" : subject === "mom" ? "parent" : subject === "baby" ? "child" : "none";
  const line = threadLine({ kind, parent: pw, child: cw.word, tiny: cw.tiny }, threadFor(scene.thread, scene.emotion));
  return redThreadPrompt(sceneText, line, feeling, kind === "both");
}
