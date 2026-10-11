// Is a two-word name's blended card meaning grounded in its two parts' standard meanings? (posts by initials, 017)
// The blend may reorder the parts' words, join them with small words ("and", "of", "one") and use a word's other form
// ("grace" → "gracious") or a close synonym ("strong" → "strength", "manly" → "man"), but every content word must come
// from a part meaning, and each part must give at least one word. "Andrew Russell — brave little fox" fails when Andrew
// means "manly, strong" and Russell "little red one": "fox" is in neither, "brave" is not "strong". Pure, no I/O.

/** Small joining words a blend may add freely. */
const FILLER = new Set(["a", "an", "the", "of", "and", "one", "ones", "who", "is", "with", "for", "to", "from", "in", "by", "at", "that", "as", "be", "his", "her", "their", "our", "my"]);

/** Close synonyms the blend may swap in (any word of a group stands for the others). Kept short and literal on purpose. */
const SYNONYMS: string[][] = [
  ["strong", "strength", "mighty", "might", "power", "powerful"],
  ["brave", "bold", "courage", "courageous", "valiant", "fearless"],
  ["grace", "gracious", "graceful", "favor", "favored"],
  ["love", "loved", "beloved", "lovely", "dear", "darling"],
  ["light", "bright", "shining", "radiant", "brilliant"],
  ["god", "divine", "godly", "heaven", "heavenly"],
  ["gift", "given", "gifted"],
  ["joy", "joyful", "joyous", "happy", "happiness", "glad", "blessed", "blissful"],
  ["peace", "peaceful", "calm", "serene"],
  ["wise", "wisdom", "sage", "learned"],
  ["noble", "nobility", "honor", "honorable"],
  ["king", "kingly", "royal", "regal", "ruler", "rule", "ruling", "reign", "sovereign"],
  ["queen", "queenly", "royal", "regal"],
  ["protector", "protection", "protect", "guardian", "guard", "defender", "defend", "shield", "helmet"],
  ["warrior", "fighter", "battle", "war", "soldier"],
  ["pure", "purity", "chaste"],
  ["free", "freedom", "liberty"],
  ["famous", "fame", "renowned", "glory", "glorious", "illustrious"],
  ["young", "youth", "youthful", "junior"],
  ["song", "melody", "music", "musical", "singer"],
  ["life", "living", "alive", "lively"],
  ["rose", "flower", "bloom", "blossom", "floral"],
  ["sea", "ocean", "marine", "seas"],
  ["hope", "hopeful"],
  ["faith", "faithful", "true", "truth", "loyal", "loyalty"],
  ["victory", "victorious", "triumph", "conqueror", "winner"],
  ["heal", "healer", "healing", "healed", "heals", "cure"],
  ["earth", "earthly", "ground", "soil"],
  ["man", "manly", "male", "masculine"],
  ["red", "ruddy"],
  ["little", "small"],
  ["great", "greatest", "grand", "big"],
  ["dark", "darkness", "black"],
  ["fair", "beautiful", "beauty", "pretty", "lovely"],
  ["dawn", "morning", "sunrise"],
  ["home", "house", "household", "dwelling"],
  ["friend", "friendly", "companion"],
  ["first", "firstborn"],
  ["father", "fatherly"], ["mother", "motherly"],
  ["fire", "fiery", "flame", "flaming", "blaze"],
  ["rich", "wealth", "wealthy", "prosperous", "fortune", "fortunate"],
];
const GROUPS = new Map<string, number[]>();
SYNONYMS.forEach((g, i) => g.forEach((w) => GROUPS.set(w, [...(GROUPS.get(w) ?? []), i])));

/** Lowercase letters-only words. */
const words = (s: string) => s.toLowerCase().replace(/[’']s\b/g, "").split(/[^a-z]+/).filter(Boolean);
/** The content words of a meaning (no filler). */
export const contentWords = (s: string) => words(s).filter((w) => !FILLER.has(w));

/** A rough stem: "gracious" → "grac", "kingly" → "king", "loved" → "lov". */
export function stem(w: string): string {
  let s = w.toLowerCase();
  if (s.length > 4 && s.endsWith("ies")) s = `${s.slice(0, -3)}y`;
  for (const suf of ["iously", "ously", "ness", "ious", "ful", "ous", "ing", "ly", "ed", "er", "est", "es", "s", "e", "y"]) {
    if (s.length - suf.length >= 3 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  }
  return s;
}

/** Do two words mean the same here: same stem, one stem a prefix of the other (4+ letters), or synonyms? */
export function sameWord(a: string, b: string): boolean {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x === y) return true;
  const sx = stem(x), sy = stem(y);
  if (sx === sy) return true;
  const [short, long] = sx.length <= sy.length ? [sx, sy] : [sy, sx];
  if (short.length >= 4 && long.startsWith(short)) return true;
  const gx = GROUPS.get(x) ?? GROUPS.get(sx), gy = GROUPS.get(y) ?? GROUPS.get(sy);
  return !!gx && !!gy && gx.some((g) => gy.includes(g));
}

/**
 * Why the blended meaning is not grounded in the part meanings, or null when it is: every content word of the blend
 * matches a word of part 1 or part 2, and each part gives at least one.
 */
export function groundingProblem(blend: string, part1: string, part2: string): string | null {
  const b = contentWords(blend), p1 = contentWords(part1), p2 = contentWords(part2);
  if (!p1.length || !p2.length) return "a part meaning is missing";
  const extra = b.filter((w) => !p1.some((p) => sameWord(w, p)) && !p2.some((p) => sameWord(w, p)));
  if (extra.length) return `"${extra.join(" ")}" is in neither part's meaning`;
  if (!b.some((w) => p1.some((p) => sameWord(w, p)))) return "nothing from the first name's meaning";
  if (!b.some((w) => p2.some((p) => sameWord(w, p)))) return "nothing from the middle name's meaning";
  return null;
}
