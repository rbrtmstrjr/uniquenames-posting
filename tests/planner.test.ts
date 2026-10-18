import { describe, expect, it } from "vitest";
import {
  BABY_SHOTS, LOOKS, NEWBORN_SHOTS, PROPS_SPECS, SITTER_SHOTS, buildCaption, buildPrompt, buildShotSpecs, buildShots, frameOf, hashSeed,
  isPropsOnly, needsProp, pickSubject, planExtraCard, planPost, seededRandom, sessionShots, shotSpec, subjectKey,
} from "@/lib/planner";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { subjectOf } from "./helpers/prompt-lines";

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

  it.each(cases)("%s, %i cards: cover first, 2 still lifes apart, a photographer's mix, every frame different", (session, count) => {
    const slots = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const specs = buildShotSpecs(count, session, seededRandom(seed * 97 + count));
      expect(specs).toHaveLength(count);
      expect(specs[0]).toBe(sessionShots(session)[0]);
      const propsIdx = specs.map((s, i) => (s.kind === "props" ? i : -1)).filter((i) => i >= 0);
      expect(propsIdx).toHaveLength(2);
      expect(propsIdx[0]).toBeGreaterThan(1);
      expect(propsIdx[1]).toBeLessThan(count - 1);
      expect(propsIdx[1] - propsIdx[0]).toBeGreaterThan(1);
      slots.add(propsIdx.join(","));
      expect(new Set(specs.map((s) => s.text)).size).toBe(count); // no frame repeats
      expect(specs.filter((s) => s.kind === "baby").every((s) => sessionShots(session).includes(s))).toBe(true);
      // the camera moves in: faces, details, small hands with a prop, prop stories and stills in every post
      const frames = specs.map(frameOf);
      expect(frames.filter((f) => f === "detail").length).toBeGreaterThanOrEqual(1);
      expect(frames.filter((f) => f === "hands").length).toBeGreaterThanOrEqual(1);
      expect(frames.filter((f) => f === "story").length).toBeGreaterThanOrEqual(2);
      expect(frames.filter((f) => f === "portrait").length).toBeGreaterThanOrEqual(2);
    }
    expect(slots.size).toBeGreaterThan(3); // the still lifes move from post to post (no fixed 4, 6, 9, 11)
  });

  it.each(sessions)("%s: neighbouring frames never share a camera angle", (session) => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const count of [9, 11, 13]) {
        const specs = buildShotSpecs(count, session, seededRandom(seed * 31 + count));
        specs.forEach((s, i) => { if (i > 0) expect(s.angle).not.toBe(specs[i - 1].angle); });
      }
    }
  });

  it("each library covers the requested camera angles, and the camera stays in close (no wide shots)", () => {
    for (const session of sessions) {
      const angles = new Set(sessionShots(session).map((s) => s.angle));
      for (const a of ["eye", "high", "closeup", "macro", "low", "profile"] as const) expect(angles.has(a)).toBe(true);
      expect(angles.has("wide")).toBe(false);
      for (const s of sessionShots(session)) expect(s.text).toMatch(/close-up|macro/);
    }
    expect(new Set(SITTER_SHOTS.map((s) => s.angle)).has("pov")).toBe(true);
    expect(new Set(NEWBORN_SHOTS.map((s) => s.angle)).has("overhead")).toBe(true);
    expect(PROPS_SPECS.every((s) => isPropsOnly(s.text) && needsProp(s) && frameOf(s) === "still")).toBe(true);
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
  it("uses each shot's own camera, and every story frame keeps the top clean for the stamped name", () => {
    for (const s of [...SITTER_SHOTS, ...NEWBORN_SHOTS, ...PROPS_SPECS]) {
      const p = buildPrompt(themes[0], s.text, "boy", { session: "sitter", look: LOOKS[0] });
      expect(p).toContain(`Photography: ${s.camera}.`);
      // the placement rides in the first sentence (later in the prompt the head still reached the name's band)
      expect(p.split("\n")[0]).toMatch(/in the bottom half of the frame\. The upper half of the frame is empty, softly blurred chocolate brown backdrop\.$/);
      expect(p).toContain("the top third of the frame is clean");
    }
  });
  it("one hero prop per frame: sharp and named in the frame, the other props only as soft shapes", () => {
    const theme = { ...themes[0], props: "wicker basket, pampas grass, felt bunny" };
    for (const s of [...SITTER_SHOTS, ...PROPS_SPECS].filter(needsProp)) {
      const p = buildPrompt(theme, s.text, "boy", { session: "sitter", look: LOOKS[0] }, "felt bunny");
      expect(p.split("\n")[0]).toContain("the felt bunny");
      expect(p).not.toContain("{prop}");
      const background = p.split("\n").find((l) => l.startsWith("Background"))!;
      if (frameOf(s) === "hands" || frameOf(s) === "detail") expect(background).not.toMatch(/basket|pampas/);
      else expect(background).toMatch(/the wicker basket and the pampas grass as soft blurred shapes/);
    }
  });
  it("names the child's whole look only when the face is in the frame", () => {
    const s = { session: "sitter" as const, look: LOOKS[0] };
    for (const spec of SITTER_SHOTS) {
      const p = buildPrompt(themes[0], spec.text, "boy", s, "wicker basket");
      const f = frameOf(spec);
      if (f === "hands" || f === "detail") {
        expect(p).not.toContain(LOOKS[0]);
        expect(p).toContain("warm light-tan skin");
        expect(p).toMatch(/^Sleeves and fabric: knit romper\.$/m);
      } else if (spec.childSoft) {
        expect(p).toContain("Out of focus behind it: an 8-month-old baby boy with soft wispy dark hair, warm light-tan skin.");
        expect(p).not.toContain("big brown eyes");
      } else {
        expect(subjectOf(p)).toContain(LOOKS[0]);
      }
    }
  });
  it("never asks for a title or mentions a camera position (the model would draw them)", () => {
    for (const s of [...SITTER_SHOTS, ...NEWBORN_SHOTS, ...PROPS_SPECS]) {
      const p = buildPrompt(themes[0], s.text, "boy", { session: "sitter", look: LOOKS[0] });
      expect(p).not.toMatch(/title/i);
      expect(s.text + " " + s.camera).not.toMatch(/camera/i);
      expect(p).not.toMatch(/tripod|stand|paper roll/i);
    }
  });
  it("every frame names a lens and an aperture, for real photoshoot depth (#5)", () => {
    for (const s of [...SITTER_SHOTS, ...NEWBORN_SHOTS, ...PROPS_SPECS]) {
      expect(s.camera).toMatch(/\bf\/\d(\.\d)?\b/);
      expect(s.camera).toMatch(/\d+mm (portrait |macro )?lens/);
    }
  });
  it("feet are shot from above or from the side, never soles to the lens from the floor (owner: it looks like a dead body)", () => {
    const all = (["newborn", "sitter", "toddler", "kid"] as const).flatMap((s) => sessionShots(s));
    const feet = all.filter((s) => /\b(feet|foot|toes)\b/.test(s.text));
    expect(feet.length).toBeGreaterThanOrEqual(5);
    for (const s of feet) {
      expect(s.text).toMatch(/from above|from the side/);
      expect(s.text).not.toMatch(/toward the viewer/);
      expect(s.camera).not.toMatch(/floor[- ]level|blanket-level/);
    }
  });
  it("faces get the 85mm wide-open portrait look, details a macro lens, focus pulls the macro lens at the prop", () => {
    const all = [...SITTER_SHOTS, ...NEWBORN_SHOTS];
    for (const s of all.filter((x) => frameOf(x) === "portrait" && x.angle !== "overhead")) expect(s.camera).toMatch(/85mm portrait lens, f\/1\.[24]/);
    for (const s of all.filter((x) => frameOf(x) === "detail" || x.angle === "macro")) expect(s.camera).toContain("100mm macro lens");
    for (const s of all.filter((x) => x.childSoft)) expect(s.camera).toContain("100mm macro lens, f/2, extremely shallow depth of field");
    for (const s of all) expect(s.camera).toMatch(/depth of field|melted into blur/);
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
  it("never plans pending (AI-suggested, not yet approved) names or themes", () => {
    const pendingNames = Array.from({ length: 20 }, (_, i) => name(`Pend Name${String.fromCharCode(65 + i)}`, "boy", "two-word", "pending"));
    const few = planPost({ request: req, names: [...boys.slice(0, 5), ...pendingNames], themes, settings });
    expect(few.ok).toBe(false);
    if (!few.ok) expect(few.reason).toMatch(/Only 5 unused boy two-word names/);
    const pendingFirst = [theme("Suggested", "boy", 0, "pending"), ...themes];
    const r = planPost({ request: req, names: boys, themes: pendingFirst, settings });
    if (!r.ok) throw new Error(r.reason);
    expect(r.theme_id).toBe("t-Boho Pampas");
    expect(planPost({ request: req, names: boys, themes: pendingFirst, settings, themeId: "t-Suggested" }).ok).toBe(false);
  });
  it("rejects a chosen theme of the wrong gender", () => {
    const r = planPost({ request: req, names: boys, themes, settings, themeId: "t-Blush Floral" });
    expect(r.ok).toBe(false);
  });
});

describe("one baby per post", () => {
  it("every face card of a post describes the same baby, and an added card matches it", () => {
    const r = planPost({ request: { ...req, count: 13 }, names: boys, themes, settings });
    if (!r.ok) throw new Error(r.reason);
    const subjectLines = r.cards.map((c) => subjectOf(c.prompt)).filter((l): l is string => !!l);
    expect(subjectLines.length).toBeGreaterThanOrEqual(4);
    expect(new Set(subjectLines).size).toBe(1);
    expect(subjectLines[0]).toContain("the same baby in every photo");
    let faces = 0;
    for (let i = 0; i < 12; i++) {
      const extra = planExtraCard({ theme: themes[0], gender: "boy", style: "two-word", names: boys, usedNameIds: r.cards.map((c) => c.name_id),
        nextPosition: 14, salt: `post-1|${i}`, subjectKey: subjectKey(req.postDate, "boy", "two-word") });
      if (!extra.ok) throw new Error(extra.reason);
      const line = subjectOf(extra.card.prompt);
      if (line) { faces++; expect(line).toBe(subjectLines[0]); }
    }
    expect(faces).toBeGreaterThan(0);
  });
  it("a post's hero props rotate: every prop gets its frames and two prop frames in a row never share one", () => {
    const theme = { ...themes[0], props: "wicker basket, pampas grass, felt bunny, wooden rattle" };
    for (const postDate of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]) {
      const r = planPost({ request: { ...req, count: 13, postDate }, names: boys, themes: [theme], settings });
      if (!r.ok) throw new Error(r.reason);
      const heroes = r.cards.filter((c) => needsProp(shotSpec(c.shot)!))
        .map((c) => ["wicker basket", "pampas grass", "felt bunny", "wooden rattle"].find((p) => c.prompt.split("\n")[0].includes(p)));
      expect(new Set(heroes)).toEqual(new Set(["wicker basket", "pampas grass", "felt bunny", "wooden rattle"]));
      heroes.forEach((h, i) => { if (i > 0) expect(h).not.toBe(heroes[i - 1]); });
    }
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

  it("never repeats a shot the post already has, and prefers an unused angle (owner: added cards looked like #1 and #4)", () => {
    const r = planPost({ request: { ...req, count: 13 }, names: boys, themes, settings });
    if (!r.ok) throw new Error(r.reason);
    const usedShots = r.cards.map((c) => c.shot);
    const usedAngles = new Set(usedShots.filter((s) => !isPropsOnly(s)).map((s) => shotSpec(s)?.angle));
    for (let i = 0; i < 40; i++) {
      const e = planExtraCard({ theme: themes[0], gender: "boy", style: "two-word", names: boys, usedNameIds: [], nextPosition: 14,
        salt: `post-1|${i}`, subjectKey: subjectKey(req.postDate, "boy", "two-word"), usedShots });
      if (!e.ok) throw new Error(e.reason);
      expect(usedShots).not.toContain(e.card.shot);
      const lib = sessionShots(pickSubject(subjectKey(req.postDate, "boy", "two-word")).session);
      const freeAngle = lib.slice(1).some((s) => !usedShots.includes(s.text) && !usedAngles.has(s.angle));
      if (freeAngle) expect(usedAngles.has(shotSpec(e.card.shot)?.angle)).toBe(false);
    }
  });

  it("adds cards one after another without repeating until the library runs out", () => {
    const usedShots: string[] = [];
    const subjKey = subjectKey(req.postDate, "boy", "two-word");
    const lib = sessionShots(pickSubject(subjKey).session);
    for (let i = 0; i < lib.length - 1; i++) {
      const e = planExtraCard({ theme: themes[0], gender: "boy", style: "two-word", names: boys, usedNameIds: [], nextPosition: i + 1,
        salt: `p|${i}`, subjectKey: subjKey, usedShots });
      if (!e.ok) throw new Error(e.reason);
      expect(usedShots).not.toContain(e.card.shot);
      usedShots.push(e.card.shot);
    }
    // library exhausted: still plans a card (least-used shot) instead of failing
    const more = planExtraCard({ theme: themes[0], gender: "boy", style: "two-word", names: boys, usedNameIds: [], nextPosition: 99, salt: "p|x", subjectKey: subjKey, usedShots });
    expect(more.ok).toBe(true);
  });
});
