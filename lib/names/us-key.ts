// The US list's lookup key, its skip note and its top-100 line (tiny and pure, no list data: shared by
// lib/names/us-list.ts, scripts/import-us-names.ts and client code such as the names PDF plan and the Names table).

/** A US name ranks below the US top 100 (spec 2026-11-24): ranks 1 to 100 are too common for Unique Names. */
export const US_MIN_RANK = 101;
/** The note on a name the US check skipped (names.autopilot_note). */
export const US_NOTE = "Not a US name";

/** "Zoë " → "zoe", "Anne-Marie" → "annemarie", "D'Angelo" → "dangelo": no accents, letters only, lowercase. */
export const usKey = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}]/gu, "").toLowerCase();

/** SSA rows that are not real names (records filed before a name was chosen). Keys, as usKey gives them. */
export const US_PLACEHOLDERS: ReadonlySet<string> = new Set(["unknown", "baby", "infant", "boy", "girl", "babyboy", "babygirl"]);
