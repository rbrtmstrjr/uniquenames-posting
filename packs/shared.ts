import { nicheId, type PackId } from "./niche";
import type { PackShared } from "./types";
import { NAME_NEST_SHARED } from "./name-nest/shared";
import { UNIQUE_NAMES_SHARED } from "./unique-names/shared";

// The client-safe part of the active pack (brand, default hashtags, closing-card messages, voices). Client components
// import THIS module, never packs/index.ts, so the prompts and topic banks stay out of the browser bundle.

const SHARED: Record<PackId, PackShared> = { "unique-names": UNIQUE_NAMES_SHARED, "name-nest": NAME_NEST_SHARED };

export const sharedPack = (): PackShared => SHARED[nicheId()];
export const brand = () => sharedPack().brand;
