import { timingSafeEqual } from "node:crypto";

export const AUTOPILOT_SECRET_MIN = 32;

/** The worker's key matches AUTOPILOT_SECRET (32+ characters), compared in constant time. */
export function keyOk(given: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < AUTOPILOT_SECRET_MIN || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
