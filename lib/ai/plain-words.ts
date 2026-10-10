// Simple global English (owner, 2026-10-10: ~80% of the audience is in the Philippines, ~20% abroad): reels and
// captions never use Filipino / Tagalog words, and lessons never use clinical or academic jargon. Pure: shared by
// the reel-script validator and the caption checks.

/**
 * Tagalog / Filipino words and common Taglish fillers, matched as whole words (any case, with a plural "s" or a
 * possessive). "ate" (older sister) and "po" (respect particle) are left out on purpose: "she ate her peas" is
 * English; the prompts tell the writer to avoid them instead.
 */
export const FILIPINO_WORDS = [
  "anak", "lola", "lolo", "sala", "merienda", "jeep", "jeepney", "palengke", "pamahiin", "kulob", "usog", "hamog", "nanay", "tatay",
  "kuya", "bunso", "opo", "salamat", "mahal", "ingat", "ofw", "naman", "talaga", "diba", "kasi", "lang", "mga", "pasaway", "ganda",
  "ubusin", "tita", "tito", "yaya", "inay", "itay",
] as const;

/**
 * Technique / therapy / study / brain words a busy mom should never have to decode (regex sources, whole words, any
 * case). The page's own catchy tip names ("the Two-Choice Rule", "the Sportscaster", "Special Time") stay fine.
 */
export const JARGON_TERMS = [
  String.raw`affect label(?:l)?ing`, String.raw`parent[-\s]child interaction therapy`, "pcit", String.raw`serve[-\s]and[-\s]return`,
  String.raw`co-?regulat\w*`, String.raw`self-regulat\w*`, String.raw`dysregulat\w*`, String.raw`emotion(?:al)? regulation`,
  String.raw`executive function\w*`, "amygdala", String.raw`prefrontal(?: cortex)?`, "cortisol", "dopamine", "serotonin", "oxytocin",
  String.raw`attachment (?:theory|style)s?`, "neuroplasticity", String.raw`neural (?:pathways?|connections?)`, String.raw`synap\w+`,
  String.raw`nervous system`, String.raw`fight[-\s]or[-\s]flight`, "harvard", String.raw`label(?:l)?ed praise`,
  "division of responsibility", String.raw`co-?viewing`, "sportscasting", String.raw`developmentally`, String.raw`cognitive\w*`,
] as const;

const FILIPINO_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${FILIPINO_WORDS.join("|")})(?:['’]s|s)?(?![\\p{L}\\p{N}])`, "iu");
const JARGON_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${JARGON_TERMS.join("|")})(?![\\p{L}\\p{N}])`, "iu");

/** The first Filipino / Tagalog word in `s` (as written), or null. */
export const filipinoWord = (s: string | null | undefined): string | null => (s ?? "").match(FILIPINO_RE)?.[0] ?? null;
/** The first jargon term in `s` (as written), or null. */
export const jargonWord = (s: string | null | undefined): string | null => (s ?? "").match(JARGON_RE)?.[0] ?? null;

/** What breaks the simple-global-English rule in `s` ("uses … (\"x\"): …"), or null. */
export function plainWordsProblem(s: string | null | undefined): string | null {
  const f = filipinoWord(s);
  if (f) return `uses a Filipino / Tagalog word ("${f}"): write simple English anyone understands`;
  const j = jargonWord(s);
  return j ? `uses expert jargon ("${j}"): say it in plain everyday words` : null;
}
