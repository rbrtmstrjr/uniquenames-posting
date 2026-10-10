// The five value-first reel formats (spec 2026-10-09-reel-storylines; research §2.3) and their rotation.
// Pure: shared by the script writer (server), the actions and the review page.

export const REEL_FORMATS = ["named_method", "say_this", "lola_science", "scene_lesson", "problem_fix"] as const;
export type ReelFormat = (typeof REEL_FORMATS)[number];

export interface FormatSpec {
  id: ReelFormat;
  /** The review page's chip. */
  label: string;
  /** The beat list, in order, used verbatim in the script prompt. */
  beats: string[];
  /** Quoted phrases (exact words to say) the narration must hold at least. */
  minQuotes: number;
}

export const FORMAT_SPECS: Record<ReelFormat, FormatSpec> = {
  // 60-90 s reels (owner, 2026-10-10): each format carries more substance (more steps / swaps / actions, a "when it
  // doesn't work" line) and at least one mid-reel RE-HOOK; never padding.
  named_method: {
    id: "named_method", label: "Named method", minQuotes: 4,
    beats: [
      "HOOK (line 1): a counterintuitive claim plus the method's name, or 'Stop saying \"X\". Try the [name] instead.'",
      "WHY THE USUAL WAY FAILS: one or two concrete lines, the brain or child's-eye reason.",
      "ANCHOR + PROMISE + OPEN LOOP: one soft credible anchor ('Psychologists call it …', 'Pediatricians suggest …'), 'Here's how.', and an open loop the reel pays off later ('The last step is the one most moms skip.').",
      "STEPS 1-5: 4-5 steps, each numbered aloud ('One…', 'Two…', 'Three…'): what to do, then the EXACT WORDS in quotes, then a micro-why or a tiny real-life example (at most 2 lines per step after its first).",
      "RE-HOOK before the hardest step ('But step four feels wrong at first…'), then pay off the open loop.",
      "IF IT DOESN'T WORK: what to do or say when your child still melts down, with the exact words in quotes.",
      "'WAIT, THAT WORKS?': the surprising reason it works ('Kids calm faster when they feel understood, not stopped.').",
      "CLOSE: restate the method's name and give one warm reframe line.",
    ],
  },
  say_this: {
    id: "say_this", label: "Say this, not that", minQuotes: 6,
    beats: [
      "HOOK (line 1): '4 things we all say that make [problem] worse, and what to say instead.' (the number matches the swaps).",
      "WHY WORDS MATTER: one or two lines on why the words change what the child does, then an open loop ('The last one is the one most moms say every day.').",
      "SWAPS 1-5: 4-5 swaps, each 'Instead of \"…\", say \"…\".' (both phrases in quotes), then a micro-why or what your child hears, in at most 2 more lines.",
      "RE-HOOK after swap 2 or 3 ('But this next one sounds kind, and it backfires…'), in fresh words.",
      "IF THEY STILL PUSH BACK: one or two lines on what to do when the new words don't land at first.",
      "BONUS: one tiny bonus tip, or the reason all the swaps work.",
      "CLOSE: one warm reframe line.",
    ],
  },
  // Global audience (owner, 2026-10-10): the id stays "lola_science" (the reels.format check constraint); the format is
  // "Grandma said, science says", with old wives' tales known in many countries.
  lola_science: {
    id: "lola_science", label: "Grandma said, science says", minQuotes: 2,
    beats: [
      "MYTH HOOK (line 1): 'Grandma said [old saying]. Here's what doctors say.' (or 'Keep it or let go? [old saying].')",
      "WHY GRANDMA BELIEVED IT, in the second person (2-3 lines): where the old saying came from and why it made sense back then; your grandma (or your mom) wanted to protect you and your child ('Your grandma wanted to keep your baby safe.'), never 'our grandmas' or 'we all grew up with'. Never mock or ridicule grandma.",
      "THE PLAIN FACT: what is true now, in everyday words, with a soft source ('pediatricians', 'doctors now say').",
      "RE-HOOK into the practical part ('So what do you do tonight instead? This part matters most.'), in fresh words.",
      "DO THIS INSTEAD: 3-4 concrete comfort-and-care actions, each with a step marker, at least two of them with exact words or a step in quotes (medical claims only from the facts given).",
      "THE SWEET PART TO KEEP: one line on what you keep from grandma's way (the care, the cuddle, the ritual).",
      "SAFETY LINE: one generic line ('If you're worried, call your pediatrician.').",
      "VERDICT + CLOSE: 'Keep it or let go? This one: let go, gently.' (or 'keep the sweet part') and one warm line.",
    ],
  },
  scene_lesson: {
    id: "scene_lesson", label: "Scene, pivot, lesson", minQuotes: 2,
    beats: [
      "HOOK (line 1): second person, in the middle of the moment, and it NAMES the problem or the mistake, never reassurance like 'don't feel bad' ('Your toddler throws his shoe. You're late. Don't say \"Stop it.\"').",
      "SCENE: 2-3 short lines (lines 2-4), present tense, one sensory detail and at most one everyday detail (the car seat, daycare pickup, the grocery store checkout).",
      "PIVOT (line 5 at the latest): 'Here's what's really happening.'",
      "WHY: the child's-eye reason (transitions are hard, a tired brain, a big feeling), in 2-3 lines.",
      "RE-HOOK into the fix ('So what do you say instead? This is the part that works.'), in fresh words.",
      "WHAT TO DO: a named script with the EXACT WORDS in quotes ('the 2-Minute Warning plus a job: \"You carry the keys.\"'), then how to say it (your tone, where you stand, when).",
      "WHEN IT DOESN'T WORK: what to say when your child still refuses or melts down, with the exact words in quotes.",
      "NEXT TIME: one line on using it before the hard moment comes.",
      "CLOSE: one warm reframe line.",
    ],
  },
  problem_fix: {
    id: "problem_fix", label: "Problem, why, fix", minQuotes: 2,
    beats: [
      "PROBLEM (line 1): the named, specific problem ('Your toddler hits when he's mad? It's not meanness. He's out of words.').",
      "EMPATHY: mirror the mom's reality in one line (empathy, never fear or guilt).",
      "WHY: the child's-eye reason in 2-3 lines, then an open loop ('There are two fixes, and the second one surprises most moms.').",
      "FIX 1: one named step with the EXACT WORDS in quotes ('Try \"Gentle Hands\": hold his hand softly and say \"Hands are for hugs. You can stomp.\"'), then why it works.",
      "RE-HOOK + FIX 2: a fresh re-hook line, then a second named step for the same problem with its own EXACT WORDS in quotes.",
      "IF THAT DOESN'T WORK: one or two lines on what to do when it still happens (stay calm, same words, try again tomorrow).",
      "CLOSING SUGGESTION: a warm nudge to try it, never a call to action ('Next time, try it once. Same words, every time.').",
    ],
  },
};

export const isReelFormat = (v: unknown): v is ReelFormat => typeof v === "string" && (REEL_FORMATS as readonly string[]).includes(v);

/** How many recent reels the rotation looks at. */
export const FORMAT_WINDOW = 5;

/**
 * The next reel's format. `recent` = the formats of the latest reels, newest first (null / unknown values are ignored).
 * Never the newest reel's format; otherwise the least recently used among the last 5 reels (a format not among them
 * first); ties go by REEL_FORMATS order.
 */
export function nextFormat(recent: (string | null | undefined)[]): ReelFormat {
  const known = recent.filter(isReelFormat).slice(0, FORMAT_WINDOW);
  const lastUse = (f: ReelFormat) => {
    const i = known.indexOf(f);
    return i < 0 ? Infinity : i;
  };
  const choices = REEL_FORMATS.filter((f) => f !== known[0]);
  // the larger the index of its newest use, the longer ago it was used
  return choices.reduce((best, f) => (lastUse(f) > lastUse(best) ? f : best), choices[0]);
}

/** A quoted phrase (the exact words to say): straight or curly double quotes, opened and closed within one line. */
export const QUOTE_RE = /["\u201c]([^"\u201c\u201d]{1,120})["\u201d]/g;
/** How many quoted phrases the lines hold. */
export const quoteCount = (lines: string[]) => lines.reduce((n, l) => n + (l.match(QUOTE_RE)?.length ?? 0), 0);
/** The quoted phrases of the lines, in order. */
export const quotedPhrases = (lines: string[]) => lines.flatMap((l) => [...l.matchAll(QUOTE_RE)].map((m) => m[1].trim()).filter(Boolean));
/** The words a quote must not follow to be the reel's key phrase: those are the phrases to stop saying. */
const NOT_THIS = /(?:instead of|stop saying|don't say|do not say|never say|not)[\s,:]*$/i;
/**
 * The reel's key phrase: the first quoted words to SAY (a phrase after "Instead of" / "Stop saying" is skipped), else the
 * first quoted phrase; null when there is none.
 */
export function keyPhrase(lines: string[]): string | null {
  const all = lines.flatMap((l) => [...l.matchAll(QUOTE_RE)].map((m) => ({ text: m[1].trim(), before: l.slice(0, m.index).replace(/[‘’]/g, "'") })))
    .filter((q) => q.text);
  return (all.find((q) => !NOT_THIS.test(q.before)) ?? all[0])?.text ?? null;
}
