import { describe, expect, it } from "vitest";
import {
  BABY_SHOTS, LOOKS, NEWBORN_SHOTS, PROPS_SPECS, SITTER_SHOTS, buildCaption, buildPrompt, buildShotSpecs, buildShots, hashSeed,
  isPropsOnly, pickSubject, planExtraCard, planPost, seededRandom, sessionShots, shotSpec, subjectKey,
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
  const sessions = ["sitter", "newborn"] as const;
  const cases = sessions.flatMap((session) => [9, 10, 11, 12, 13].map((count) => [session, count] as const));

  it.each(cases)("%s, %i cards: cover first, 3-4 props-only shots spread out, every frame different", (session, count) => {
    for (let seed = 1; seed <= 40; seed++) {
      const specs = buildShotSpecs(count, session, seededRandom(seed * 97 + count));
      expect(specs).toHaveLength(count);
      expect(specs[0]).toBe(sessionShots(session)[0]);
      const propsIdx = specs.map((s, i) => (s.kind === "props" ? i : -1)).filter((i) => i >= 0);
      expect(propsIdx).toHaveLength(count >= 11 ? 4 : 3);
      expect(propsIdx[0]).toBeGreaterThan(1);
      propsIdx.forEach((p, i) => { if (i > 0) expect(p - propsIdx[i - 1]).toBeGreaterThan(1); });
      expect(specs[propsIdx[0]]).toBe(PROPS_SPECS[0]); // the empty set comes before the other props frames
      expect(new Set(specs.map((s) => s.text)).size).toBe(count); // no frame repeats
      expect(specs.filter((s) => s.kind === "baby").every((s) => sessionShots(session).includes(s))).toBe(true);
    }
  });

  it.each(sessions)("%s: neighbouring frames never share a camera angle", (session) => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const count of [9, 11, 13]) {
        const specs = buildShotSpecs(count, session, seededRandom(seed * 31 + count));
        specs.forEach((s, i) => { if (i > 0) expect(s.angle).not.toBe(specs[i - 1].angle); });
      }
    }
  });

  it("each library covers the requested camera angles", () => {
    for (const session of sessions) {
      const angles = new Set(sessionShots(session).map((s) => s.angle));
      for (const a of ["eye", "wide", "high", "closeup", "macro", "low", "profile"] as const) expect(angles.has(a)).toBe(true);
    }
    expect(new Set(SITTER_SHOTS.map((s) => s.angle)).has("pov")).toBe(true);
    expect(new Set(NEWBORN_SHOTS.map((s) => s.angle)).has("overhead")).toBe(true);
    expect(PROPS_SPECS.every((s) => isPropsOnly(s.text))).toBe(true);
  });

  it("buildShots returns the texts and keeps the old preview shot", () => {
    expect(buildShots(9, seededRandom(1))[0]).toBe(BABY_SHOTS[0]);
    expect(shotSpec(BABY_SHOTS[0])?.angle).toBe("eye");
    expect(shotSpec("an old shot from a previous version")).toBeUndefined();
  });
});

describe("subject", () => {
  it("is the same for the same post and varies between posts", () => {
    expect(pickSubject("2026-10-05|boy|two-word")).toEqual(pickSubject("2026-10-05|boy|two-word"));
    const all = Array.from({ length: 200 }, (_, i) => pickSubject(`2026-01-01|girl|single|${i}`));
    expect(new Set(all.map((s) => s.session))).toEqual(new Set(["newborn", "sitter"]));
    expect(new Set(all.map((s) => s.look)).size).toBe(LOOKS.length);
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
  it("uses each shot's own camera and reserves the title space it names", () => {
    const high = SITTER_SHOTS.find((s) => s.angle === "high")!;
    const p = buildPrompt(themes[0], high.text, "boy", { session: "sitter", look: LOOKS[0] });
    expect(p).toContain(`Photography: ${high.camera}`);
    expect(p).toContain("keep the lower third of the frame calm and empty");
    expect(p).not.toContain("lower 60 percent");
    const flat = PROPS_SPECS[1];
    expect(buildPrompt(themes[0], flat.text, "boy")).toContain(`Photography: ${flat.camera}`);
  });
  it("never asks for a title or mentions a camera position (the model would draw them)", () => {
    for (const s of [...SITTER_SHOTS, ...NEWBORN_SHOTS, ...PROPS_SPECS]) {
      const p = buildPrompt(themes[0], s.text, "boy", { session: "sitter", look: LOOKS[0] });
      expect(p).not.toMatch(/title/i);
      expect(s.text + " " + s.camera).not.toMatch(/camera/i);
      expect(p).not.toMatch(/tripod|stand|paper roll/i);
    }
  });
  it("names the same baby, with session age and look, in every baby frame", () => {
    const s = { session: "newborn" as const, look: LOOKS[2] };
    const p = buildPrompt(themes[0], NEWBORN_SHOTS[3].text, "girl", s);
    expect(p).toContain("the same baby in every photo of this session");
    expect(p).toContain("newborn baby girl, about 10 days old");
    expect(p).toContain(LOOKS[2]);
    expect(buildPrompt(themes[0], PROPS_SPECS[0].text, "girl", s)).not.toContain(LOOKS[2]);
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

describe("one baby per post", () => {
  it("every baby card of a post describes the same baby, and an added card matches it", () => {
    const r = planPost({ request: { ...req, count: 13 }, names: boys, themes, settings });
    if (!r.ok) throw new Error(r.reason);
    const subjectLines = r.cards.filter((c) => !isPropsOnly(c.shot)).map((c) => c.prompt.split("\n")[1]);
    expect(new Set(subjectLines).size).toBe(1);
    expect(subjectLines[0]).toContain("the same baby in every photo");
    const extra = planExtraCard({ theme: themes[0], gender: "boy", style: "two-word", names: boys, usedNameIds: r.cards.map((c) => c.name_id),
      nextPosition: 14, salt: "post-1|123", subjectKey: subjectKey(req.postDate, "boy", "two-word") });
    if (!extra.ok) throw new Error(extra.reason);
    expect(extra.card.prompt.split("\n")[1]).toBe(subjectLines[0]);
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
