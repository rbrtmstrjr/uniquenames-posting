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
      "PROBLEM (line 1): the named, specific problem ('Bedtime takes an hour? It's usually not the sleep. It's the goodbye.').",
      "EMPATHY: mirror the mom's reality in one line (empathy, never fear or guilt).",
      "WHY: the child's-eye reason.",
      "FIX: one named step with the EXACT WORDS in quotes ('Try \"Last 3 Things\": last hug, last song, last \"I love you.\"').",
      "CLOSING SUGGESTION: a warm nudge to try it, never a call to action ('Tonight, try it once. Same three, same order.').",
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
