import { describe, expect, it } from "vitest";
import {
  BABY_SHOTS, buildCaption, buildPrompt, buildShots, hashSeed, isPropsOnly, planExtraCard, planPost, seededRandom,
} from "@/lib/planner";
import type { NameRow, ThemeRow } from "@/lib/db/types";

const now = "2026-10-04T00:00:00Z";
let n = 0;
const name = (nm: string, gender: "boy" | "girl" = "boy", style: "two-word" | "single" = "two-word", status: NameRow["status"] = "available"): NameRow => ({
  id: `n${++n}`, name: nm, meaning: "a meaning", gender, style, status, post_id: null, position: null, created_at: now, updated_at: now,
});
const theme = (title: string, gender: "boy" | "girl", sort_order: number, status: ThemeRow["status"] = "available"): ThemeRow => ({
  id: `t-${title}`, title, gender, backdrop: "smooth seamless chocolate brown studio backdrop", outfit: "knit romper",
  props: "wicker basket, pampas grass", lighting: "soft light", palette: "brown and cream", status, sort_order, used_on: null,
  preview_card_id: null, created_at: now, updated_at: now,
});
const boys = Array.from({ length: 20 }, (_, i) => name(`Boy Name${String.fromCharCode(65 + i)}`));
const themes = [theme("Boho Pampas", "boy", 1), theme("Little Star", "boy", 2), theme("Blush Floral", "girl", 1)];
const settings = { caption_template: "Here are some beautiful names you can give to your baby {gender}. 🥰", hashtags: "#parenting #uniquenames", min_images: 9, max_images: 13 };
const req = { gender: "boy" as const, style: "two-word" as const, count: null, postDate: "2026-10-05" };

describe("random", () => {
  it("is deterministic", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    const a = seededRandom(5), b = seededRandom(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("shots", () => {
  it.each([9, 10, 11, 12, 13])("%i shots: first is a baby, right props-only count, never adjacent", (count) => {
    const s = buildShots(count, seededRandom(count));
    expect(s).toHaveLength(count);
    expect(s[0]).toBe(BABY_SHOTS[0]);
    expect(s.filter(isPropsOnly)).toHaveLength(count >= 11 ? 2 : 1);
    s.forEach((x, i) => { if (i > 0) expect(isPropsOnly(x) && isPropsOnly(s[i - 1])).toBe(false); });
  });
});

describe("prompt", () => {
  it("baby shot keeps the whole set and the no-text rule", () => {
    const p = buildPrompt(themes[0], BABY_SHOTS[0], "boy");
    expect(p).toContain("baby boy");
    expect(p).toContain("chocolate brown");
    expect(p).toContain("wicker basket");
    expect(p).toMatch(/No text, no letters/);
  });
  it("props-only never says baby photoshoot", () => {
    const p = buildPrompt(themes[0], "a props-only still life with no baby in the picture: x", "girl");
    expect(p).not.toContain("baby photoshoot");
    expect(p).toMatch(/no baby, no child, no person/);
    expect(p).toContain("wicker basket");
  });
});

describe("caption", () => {
  it("fills gender and appends hashtags", () => {
    expect(buildCaption("girl", settings)).toBe("Here are some beautiful names you can give to your baby girl. 🥰\n\n#parenting #uniquenames");
  });
});

describe("planPost", () => {
  it("plans 9-13 distinct boy names on the first boy theme", () => {
    const r = planPost({ request: req, names: boys, themes, settings });
    if (!r.ok) throw new Error(r.reason);
    expect(r.cards.length).toBeGreaterThanOrEqual(9);
    expect(r.cards.length).toBeLessThanOrEqual(13);
    expect(new Set(r.cards.map((c) => c.name_id)).size).toBe(r.cards.length);
    expect(r.theme_id).toBe("t-Boho Pampas");
    expect(r.cards.map((c) => c.position)).toEqual(r.cards.map((_, i) => i + 1));
    expect(r.cards.every((c) => Number.isSafeInteger(c.seed) && c.seed > 0)).toBe(true);
    expect(r.cards.every((c) => r.cards.every((d) => !c.prompt.includes(d.name)))).toBe(true);
    expect(r.caption).toContain("baby boy");
  });
  it("is deterministic for the same date", () => {
    const a = planPost({ request: req, names: boys, themes, settings });
    const b = planPost({ request: req, names: boys, themes, settings });
    expect(a).toEqual(b);
  });
  it("honours an exact count and a chosen theme", () => {
    const r = planPost({ request: { ...req, count: 12 }, names: boys, themes, settings, themeId: "t-Little Star" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.cards).toHaveLength(12);
    expect(r.theme_id).toBe("t-Little Star");
  });
  it("skips used, reserved and skip names and other genders/styles", () => {
    const mixed = [...boys.slice(0, 10), name("Taken One", "boy", "two-word", "used"), name("Skip Me", "boy", "two-word", "skip"), name("Girl Name", "girl"), name("Solo", "boy", "single")];
    const r = planPost({ request: { ...req, count: 10 }, names: mixed, themes, settings });
    if (!r.ok) throw new Error(r.reason);
    expect(r.cards.map((c) => c.name).sort()).toEqual(boys.slice(0, 10).map((b) => b.name).sort());
  });
  it("stops clearly when too few names", () => {
    const r = planPost({ request: req, names: boys.slice(0, 5), themes, settings });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Only 5 unused boy two-word names/);
  });
  it("stops clearly when no theme is left", () => {
    const r = planPost({ request: req, names: boys, themes: themes.map((t) => ({ ...t, status: "used" as const })), settings });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/No unused boy theme/);
  });
  it("rejects a chosen theme of the wrong gender", () => {
    const r = planPost({ request: req, names: boys, themes, settings, themeId: "t-Blush Floral" });
    expect(r.ok).toBe(false);
  });
});

describe("planExtraCard", () => {
  it("picks one more available name with a baby shot", () => {
    const r = planExtraCard({ theme: themes[0], gender: "boy", style: "two-word", names: boys, usedNameIds: [boys[0].id], nextPosition: 10, salt: "x" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.card.position).toBe(10);
    expect(r.card.name_id).not.toBe(boys[0].id);
    expect(isPropsOnly(r.card.shot)).toBe(false);
  });
});
