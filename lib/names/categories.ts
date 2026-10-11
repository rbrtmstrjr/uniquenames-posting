// The meaning groups of the names PDF (migration 018: names.meaning_category). A fixed list, the same ids for every
// pack (the database checks them); each pack words the labels its own way (packs/<id>/shared.ts `nameCategories`).
// Client-safe: no imports.

export const MEANING_CATEGORIES = [
  "nature", "light", "water", "strength", "faith", "love", "wisdom", "royal", "peace", "gems", "earth", "more",
] as const;
export type MeaningCategory = (typeof MEANING_CATEGORIES)[number];

/** Where a name goes when nothing else fits (always the last group). */
export const FALLBACK_CATEGORY: MeaningCategory = "more";

export const isMeaningCategory = (v: unknown): v is MeaningCategory =>
  typeof v === "string" && (MEANING_CATEGORIES as readonly string[]).includes(v);

/** What each group holds, for the AI that sorts the names (lib/ai/categorize). */
export const CATEGORY_HINTS: Readonly<Record<MeaningCategory, string>> = {
  nature: "flowers, plants, trees, leaves, gardens, meadows, birds and other animals",
  light: "light, sun, moon, stars, sky, dawn, fire, shining, bright, radiant",
  water: "water, sea, ocean, rivers, rain, lakes, waves, springs",
  strength: "strength, courage, bravery, warriors, protectors, victory, power, firm and strong",
  faith: "God, faith, prayer, blessings, a gift from God, God is gracious, holy, angels, heaven",
  love: "love, joy, happiness, delight, laughter, beloved, dear, friend, cheerful",
  wisdom: "wisdom, intelligence, grace, gentleness, kindness, honor, truth, purity, goodness",
  royal: "kings, queens, princes, princesses, nobles, rulers, crowns, glory, fame, leaders",
  peace: "peace, calm, rest, quiet, harmony, hope, comfort, serenity",
  gems: "jewels, gems, gold, pearls, precious things, beauty, lovely, fair, graceful looks",
  earth: "earth, land, hills, valleys, fields, stone, seasons, months, places, homes, life, time",
  more: "anything that fits none of the other groups",
};

/** Group order in the PDF: the list's order, unknown / missing last as the fallback group. */
export const categoryRank = (c: string | null | undefined): number => {
  const i = (MEANING_CATEGORIES as readonly string[]).indexOf(c ?? "");
  return i < 0 ? MEANING_CATEGORIES.indexOf(FALLBACK_CATEGORY) : i;
};
