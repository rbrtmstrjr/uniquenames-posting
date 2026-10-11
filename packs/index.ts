import { nicheId, type PackId } from "./niche";
import type { NichePack } from "./types";
import { NAME_NEST } from "./name-nest";
import { UNIQUE_NAMES } from "./unique-names";

// The active niche pack (docs/PACKS.md), chosen by env NICHE (default "unique-names"). Server-safe plain modules:
// client components use packs/shared instead.

export { DEFAULT_NICHE, PACK_IDS, nicheId, type PackId } from "./niche";
export type * from "./types";

const PACKS: Record<PackId, NichePack> = { "unique-names": UNIQUE_NAMES, "name-nest": NAME_NEST };

export const activePack = (): NichePack => PACKS[nicheId()];
/** A pack by id (tests, seed scripts). */
export const packById = (id: PackId): NichePack => PACKS[id];
