import { nicheId, type PackId } from "./niche";
import type { NichePack } from "./types";
import { UNIQUE_NAMES } from "./unique-names";

// The active niche pack (docs/PACKS.md), chosen by env NICHE (default "unique-names"). Server-safe plain modules:
// client components use packs/shared instead.

export { DEFAULT_NICHE, PACK_IDS, nicheId, type PackId } from "./niche";
export type * from "./types";

const PACKS: Record<PackId, NichePack> = { "unique-names": UNIQUE_NAMES };

export const activePack = (): NichePack => PACKS[nicheId()];
/** A pack by id (tests, seed scripts). */
export const packById = (id: PackId): NichePack => PACKS[id];
