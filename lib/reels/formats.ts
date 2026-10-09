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
  named_method: {
    id: "named_method", label: "Named method", minQuotes: 3,
    beats: [
      "HOOK (line 1): a counterintuitive claim plus the method's name, or 'Stop saying \"X\". Try the [name] instead.'",
      "WHY THE USUAL WAY FAILS: one concrete line, the brain or child's-eye reason.",
      "ANCHOR + PROMISE: one soft credible anchor ('Psychologists call it …', 'Pediatricians suggest …') and 'Here's how.'",
      "STEPS 1-3: each step is numbered aloud ('One…', 'Two…', 'Three…'): what to do, then the EXACT WORDS in quotes, then a micro-why of at most 15 words.",
      "'WAIT, THAT WORKS?': the surprising reason it works ('Kids calm faster when they feel understood, not stopped.').",
      "CLOSE: restate the method's name and give one warm reframe line.",
    ],
  },
  say_this: {
    id: "say_this", label: "Say this, not that", minQuotes: 3,
    beats: [
      "HOOK (line 1): '3 things we all say that make [problem] worse, and what to say instead.'",
      "WHY WORDS MATTER: one line on why the words change what the child does.",
      "SWAPS 1-3: each swap is 'Instead of \"…\", say \"…\".' (both phrases in quotes), then a micro-why of at most 15 words.",
      "BONUS: one tiny bonus tip, or the reason all three swaps work.",
      "CLOSE: one warm reframe line.",
    ],
  },
  lola_science: {
    id: "lola_science", label: "Lola said, science says", minQuotes: 1,
    beats: [
      "MYTH HOOK (line 1): 'Lola said: [myth]. Here's what doctors say.' (or 'Keep it or let go? [tradition].')",
      "HONOUR LOLA: why people believed it; lola wanted to protect the child. Never mock or ridicule lola.",
      "THE PLAIN FACT: what is true now, with a soft source ('pediatricians', 'doctors now say').",
      "DO THIS INSTEAD: 2-3 concrete actions, with at least one exact phrase or step in quotes.",
      "SAFETY LINE: one generic line ('If you're worried, call your pediatrician.').",
      "VERDICT + CLOSE: 'Keep it or let go? This one: let go, gently.' (or 'keep the sweet part') and one warm line.",
    ],
  },
  scene_lesson: {
    id: "scene_lesson", label: "Scene, pivot, lesson", minQuotes: 1,
    beats: [
      "HOOK (line 1): second person, in the middle of the moment, and it states the mistake or the promise ('Your toddler throws his shoe. You're late. Don't say \"Stop it.\"').",
      "SCENE: at most 2 short lines, present tense, one sensory detail and at most one local detail (lola's house, the jeep, the sala).",
      "PIVOT (by about second 11): 'Here's what's really happening.'",
      "WHY: the child's-eye reason (transitions are hard, a tired brain, a big feeling).",
      "WHAT TO DO: a named script with the EXACT WORDS in quotes ('the 2-Minute Warning plus a job: \"You carry the keys.\"').",
      "CLOSE: one warm reframe line.",
    ],
  },
  problem_fix: {
    id: "problem_fix", label: "Problem, why, fix", minQuotes: 1,
    beats: [
      "PROBLEM (line 1): the named, specific problem ('Your toddler hits when he's mad? It's not meanness. He's out of words.').",
      "EMPATHY: mirror the mom's reality in one line (empathy, never fear or guilt).",
      "WHY: the child's-eye reason.",
      "FIX: one named step with the EXACT WORDS in quotes ('Try \"Gentle Hands\": hold his hand softly and say \"Hands are for hugs. You can stomp.\"').",
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
