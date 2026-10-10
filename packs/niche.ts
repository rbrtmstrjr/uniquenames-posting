// Which page this deployment serves: env NICHE (unset or empty = "unique-names"). next.config.ts inlines NICHE at
// build time, so browser code reads the same value as the server. A leaf module (no imports).

export const DEFAULT_NICHE = "unique-names";
export const PACK_IDS = ["unique-names", "name-nest"] as const;
export type PackId = (typeof PACK_IDS)[number];

/** The active pack id; throws on an unknown NICHE (a misconfigured deployment must fail loudly, never post as another page). */
export function nicheId(): PackId {
  const raw = (process.env.NICHE ?? "").trim() || DEFAULT_NICHE;
  if (!(PACK_IDS as readonly string[]).includes(raw)) {
    throw new Error(`Unknown NICHE "${raw}": use one of ${PACK_IDS.join(", ")} (see docs/PACKS.md).`);
  }
  return raw as PackId;
}
