import { describe, expect, it } from "vitest";
import type { ThemeRow } from "@/lib/db/types";
import { CTA_SHOT_PREFIX, NO_TEXT, buildCtaPrompt, isCtaShot, pickSubject, planCtaCard, planExtraCard, subjectKey, SUBJECT_AGES } from "@/lib/planner";

const theme = {
  id: "t1", title: "Cotton Clouds", gender: "boy", backdrop: "smooth seamless pastel sky-blue studio backdrop with cotton clouds",
  outfit: "a tiny white knit romper", props: "a woven basket, fluffy cotton clouds, a small wooden star", lighting: "soft diffused window light",
  palette: "sky blue, white, warm wood", status: "used", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
} as ThemeRow;
const key = subjectKey("2026-10-09", "boy", "single");

describe("closing card prompt", () => {
  it("the same set and child as the post, the upper area left calm for the message, NO_TEXT last, positive only", () => {
    for (const age of [...SUBJECT_AGES, "random", null] as const) {
      const r = planCtaCard({ theme, gender: "boy", subjectKey: key, age, salt: "post-1", position: 12, text: "Follow for more / baby name ideas." });
      const p = r.prompt;
      expect(p, String(age)).toContain(`Backdrop: ${theme.backdrop}.`);
      expect(p).toContain(`Props: ${theme.props}.`);
      expect(p).toContain(`Lighting: ${theme.lighting}.`);
      expect(p).toMatch(/upper half of the frame is calm, open backdrop/);
      expect(p).toMatch(/lower half of the frame/);
      expect(p.trim().endsWith(NO_TEXT)).toBe(true);
      expect(p).not.toMatch(/camera/i);
      // positive-only: NO_TEXT is the only "no ..." line
      expect(p.replace(NO_TEXT, "")).not.toMatch(/\b(no|without|avoid|never)\b/i);
      expect(r.shot.startsWith(CTA_SHOT_PREFIX)).toBe(true);
      expect(isCtaShot(r.shot)).toBe(true);
    }
  });

  it("a fixed-age post shows the post's own child (same look as its name cards)", () => {
    const r = planCtaCard({ theme, gender: "girl", subjectKey: key, age: "3", salt: "p", position: 10, text: "x" });
    const child = pickSubject(key, "3");
    expect(r.prompt).toContain(child.look);
    expect(r.prompt).toMatch(/3-year-old girl/);
    const extra = planExtraCard({ theme, gender: "girl", style: "single", names: [{ id: "n", name: "Ava", meaning: "life", gender: "girl", style: "single", status: "available", post_id: null, position: null, created_at: "", updated_at: "" }],
      usedNameIds: [], nextPosition: 11, salt: "s", subjectKey: key, age: "3" });
    expect(extra.ok && extra.card.prompt).toContain(child.look);
  });

  it("a post made before ages keeps its original baby", () => {
    const r = planCtaCard({ theme, gender: "boy", subjectKey: key, age: null, salt: "p", position: 10, text: "x" });
    expect(r.prompt).toContain(pickSubject(key).look);
  });

  it("is a closing card row: the message as its name, no meaning, a stable seed per post", () => {
    const a = planCtaCard({ theme, gender: "boy", subjectKey: key, age: "random", salt: "post-1", position: 12, text: "Follow for more / baby name ideas." });
    const b = planCtaCard({ theme, gender: "boy", subjectKey: key, age: "random", salt: "post-1", position: 12, text: "Follow for more / baby name ideas." });
    expect(a).toMatchObject({ kind: "cta", position: 12, name: "Follow for more / baby name ideas.", meaning: "" });
    expect(a.seed).toBe(b.seed);
    expect(Number.isSafeInteger(a.seed) && a.seed > 0).toBe(true);
    expect(planCtaCard({ theme, gender: "boy", subjectKey: key, age: "random", salt: "post-2", position: 12, text: "x" }).seed).not.toBe(a.seed);
  });

  it("buildCtaPrompt without a subject still describes a baby of the post's gender", () => {
    expect(buildCtaPrompt(theme, "girl")).toMatch(/baby girl/);
  });
});
