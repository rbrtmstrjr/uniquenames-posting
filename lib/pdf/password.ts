import { randomBytes, randomInt } from "node:crypto";

// The names PDF's passwords: a NEW one for every download (brief 2026-10-11-names-pdf). The buyer types the open
// password, so it is short and easy to read: 12 letters and digits in three groups ("Kp7m-Xr4d-Tq9w"), never a
// character that looks like another (0 O o, 1 l I i). The owner password (full rights) is long, random and never shown.

/** Letters and digits that cannot be mistaken for each other. */
export const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export const PASSWORD_RE = /^[A-HJ-NP-Za-hj-km-np-z2-9]{4}-[A-HJ-NP-Za-hj-km-np-z2-9]{4}-[A-HJ-NP-Za-hj-km-np-z2-9]{4}$/;

const strong = (s: string) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /[2-9]/.test(s);

/** A fresh open password; `pick(n)` = a random integer in [0, n) (crypto by default; tests pass their own). */
export function newPassword(pick: (n: number) => number = (n) => randomInt(n)): string {
  for (let tries = 0; tries < 200; tries++) {
    const chars = Array.from({ length: 12 }, () => PASSWORD_ALPHABET[pick(PASSWORD_ALPHABET.length)]);
    const pw = [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((g) => g.join("")).join("-");
    if (strong(pw)) return pw;
  }
  throw new Error("Could not make a password.");
}

/** The owner password: 32 random characters, different from the open password every time. */
export const newOwnerPassword = (): string => randomBytes(24).toString("base64url");
