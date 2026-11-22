import { describe, expect, it } from "vitest";
import type { Gender, ThemeRow } from "@/lib/db/types";
import { packById } from "@/packs";
import {
  COVER_SHOT_PREFIX, NO_TEXT, buildCoverPrompt, coverPoseId, coverShot, isCoverShot, nextTitlePlace, pickCoverPose, pickSubject,
  planCoverCard, planCtaCard, subjectKey, withNameOrder, type Session,
} from "@/lib/planner";

// The front card (spec 2026-11-21): the pose pool and title wording of the Unique Names pack, the prompt, the pose
// rotation (least recently used, never the previous post's) and the title place (alternating top / bottom).
const cover = packById("unique-names").cards.cover!;
const poses = cover.poses;
const SESSIONS: Session[] = ["newborn", "sitter", "toddler", "kid"];
const theme: ThemeRow = {
  id: "t1", title: "Boho Pampas", gender: "boy", backdrop: "smooth seamless chocolate brown studio backdrop with a soft darker vignette",
  outfit: "a tiny cream knitted romper with a little collar", props: "wicker basket, pampas grass, felt bunny",
  lighting: "soft warm light from the left, gentle shadows, cozy", palette: "brown, cream, oat and soft gold",
  status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};

describe("front card pack data", () => {
  it("10 poses with unique ids, each written for every session, with no words the model would draw", () => {
    expect(poses).toHaveLength(10);
    expect(new Set(poses.map((p) => p.id)).size).toBe(10);
    for (const p of poses) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.optics.trim()).not.toBe("");
      expect(p.optics).not.toMatch(/camera/i);
      for (const s of SESSIONS) {
        expect(p.moment[s]?.trim(), `${p.id} / ${s}`).toBeTruthy();
        expect(p.moment[s]).not.toMatch(/camera|\{prop\}|\blamp\b|\bstudio\b/i);
      }
      // a newborn sleeps: never asked to crawl, stand or walk
      expect(p.moment.newborn).toMatch(/newborn/);
      expect(p.moment.newborn).not.toMatch(/crawl|stand|walk/i);
    }
  });

  it("the title wording for letter, name theme, initials, series and plain posts", () => {
    expect(cover.title({ gender: "boy", letter: "S" })).toEqual({ main: "'S' Names", second: "for baby boy" });
    expect(cover.title({ gender: "girl", nameTheme: "Biblical" })).toEqual({ main: "Biblical Names", second: "for baby girl" });
    expect(cover.title({ gender: "girl", nameTheme: "Royal names" })).toEqual({ main: "Royal names", second: "for baby girl" });
    expect(cover.title({ gender: "girl", initials: "AR" })).toEqual({ main: "A & R Names", second: "for baby girl" });
    expect(cover.title({ gender: "girl", seriesPart: 1 })).toEqual({ main: "A to Z Names", second: "part 1 · for baby girl" });
    expect(cover.title({ gender: "boy" })).toEqual({ main: "Baby Boy Names", second: "" });
    expect(cover.title({ gender: "girl", letter: null, nameTheme: null, initials: null, seriesPart: null })).toEqual({ main: "Baby Girl Names", second: "" });
  });

  it("name-theme titles are title-cased: each word and hyphen part, small words lowercase unless first, the rest of a word kept", () => {
    const main = (nameTheme: string) => cover.title({ gender: "girl", nameTheme }).main;
    expect(main("Unique and modern")).toBe("Unique and Modern Names");
    expect(main("Nature-inspired")).toBe("Nature-Inspired Names");
    expect(main("Biblical")).toBe("Biblical Names");
    expect(main("names of the sea")).toBe("Names of the Sea Names");
    expect(main("the old ways")).toBe("The Old Ways Names");
    expect(main("  Gems   for  girls ")).toBe("Gems for Girls Names");
    expect(main("McDonald and ABC")).toBe("McDonald and ABC Names");
    expect(main("Royal names")).toBe("Royal names");
    expect(main("old-world names")).toBe("old-world names");
    expect(cover.title({ gender: "boy", letter: "s" }).main).toBe("'S' Names");
  });

  it("face, tummy and low-angle allow a top title only; the others allow both places", () => {
    for (const p of poses) {
      if (["face", "tummy", "low-angle"].includes(p.id)) expect(p.places, p.id).toEqual(["top"]);
      else expect(p.places, p.id).toBeUndefined();
    }
  });

  it("the newborn tummy pose sleeps on the back, wrapped; the face pose is a portrait low in the frame", () => {
    const by = (id: string) => poses.find((p) => p.id === id)!;
    expect(by("tummy").moment.newborn).toMatch(/on the back/);
    expect(by("tummy").moment.newborn).not.toMatch(/tummy/);
    for (const s of SESSIONS) expect(by("face").moment[s]).toMatch(/lower half of the frame/);
    expect(by("hug").moment.toddler).not.toMatch(/hugging the softest prop close with both arms, the eyes/);
    for (const s of SESSIONS) expect(by("hug").moment[s]).toMatch(/wide/);
  });

  it("Name Nest has no front card", () => {
    expect(packById("name-nest").cards.cover).toBeUndefined();
  });
});

describe("the pose and the title place change from post to post", () => {
  const ids = poses.map((p) => p.id);

  it("never-used poses first in list order, never the previous post's, else the one used longest ago", () => {
    expect(pickCoverPose(poses, []).id).toBe(ids[0]);
    expect(pickCoverPose(poses, [ids[0]]).id).toBe(ids[1]);
    const allUsed = [ids[3], ids[0], ids[1], ids[2], ids[4], ids[5], ids[6], ids[7], ids[8], ids[9]];
    expect(pickCoverPose(poses, allUsed).id).toBe(ids[9]);
    // unreadable or unknown shots are ignored
    expect(pickCoverPose(poses, [null, "gone", ids[0]]).id).toBe(ids[1]);
    expect(pickCoverPose(poses.slice(0, 2), [ids[1], ids[0]]).id).toBe(ids[0]);
    expect(pickCoverPose(poses.slice(0, 1), [ids[0]]).id).toBe(ids[0]);
  });

  it("over a long run the pose never matches the previous post's and every pose comes round", () => {
    const recent: string[] = [];
    for (let k = 0; k < 40; k++) {
      const p = pickCoverPose(poses, recent);
      expect(p.id).not.toBe(recent[0]);
      recent.unshift(p.id);
    }
    expect(new Set(recent.slice(0, 10)).size).toBe(10);
  });

  it("with a place, only poses that allow it are picked; never the previous post's; all poses when none allow it", () => {
    const top = poses.filter((p) => p.places);
    expect(top.length).toBeGreaterThan(0);
    expect(pickCoverPose(poses, [], "bottom").id).toBe("wide");
    expect(pickCoverPose(poses, ["wide"], "bottom").id).toBe("top-down");
    expect(pickCoverPose(poses, [], "top").id).toBe("wide");
    const onlyTop = poses.filter((p) => p.places?.[0] === "top");
    expect(pickCoverPose(onlyTop, [], "bottom").id).toBe(onlyTop[0].id);
    expect(pickCoverPose(poses, ["wide"]).id).toBe("face");
  });

  it("a 40-post run (each pose and place fed back) never gives a pose a place it does not allow; every pose, top-only ones too, comes round", () => {
    const recent: string[] = [];
    let prevPlace: string | undefined;
    const seen = new Set<string>();
    for (let k = 0; k < 40; k++) {
      const place = nextTitlePlace(prevPlace);
      const p = pickCoverPose(poses, recent, place);
      expect(p.places ?? ["top", "bottom"], `${k}: ${p.id} at ${place}`).toContain(place);
      expect(p.id).not.toBe(recent[0]);
      seen.add(p.id);
      recent.unshift(p.id);
      prevPlace = place;
    }
    expect(seen.size).toBe(10);
    for (const id of ["face", "tummy", "low-angle"]) expect(seen.has(id), id).toBe(true);
  });

  it("the title place alternates (top when there is no previous front card)", () => {
    expect(nextTitlePlace("top")).toBe("bottom");
    expect(nextTitlePlace("bottom")).toBe("top");
    expect(nextTitlePlace(null)).toBe("top");
    expect(nextTitlePlace(undefined)).toBe("top");
    expect(nextTitlePlace("middle")).toBe("top");
  });
});

describe("planCoverCard", () => {
  const key = subjectKey("2026-11-22", "boy", "single");
  const base = { theme, gender: "boy" as Gender, subjectKey: key, age: "2" as const, salt: "post-1", pose: poses[0], place: "top" as const,
    title: { main: "'S' Names", second: "for baby boy" } };

  it("the post's set and child in the pose, the title as its text, first (position 0), the place stored", () => {
    const c = planCoverCard(base);
    expect(c).toMatchObject({ kind: "cover", position: 0, name: "'S' Names", meaning: "for baby boy", title_pos: "top" });
    const child = pickSubject(key, "2");
    expect(isCoverShot(c.shot)).toBe(true);
    expect(c.shot).toBe(coverShot(poses[0], child.session));
    expect(coverPoseId(c.shot)).toBe(poses[0].id);
    expect(c.prompt).toContain(child.look);
    expect(c.prompt).toContain(theme.backdrop);
    expect(c.prompt).toContain(poses[0].moment.toddler);
    // the same child as the closing card of this fixed-age post, but a seed of its own
    const cta = planCtaCard({ theme, gender: "boy", subjectKey: key, age: "2", salt: "post-1", position: 10, text: "Follow" });
    expect(cta.prompt).toContain(child.look);
    expect(c.seed).not.toBe(cta.seed);
  });

  it("keeps the title's third calm: the upper third for a top title, the lower third for a bottom one; text-free", () => {
    const top = planCoverCard(base).prompt;
    const bottom = planCoverCard({ ...base, place: "bottom" }).prompt;
    expect(top).toMatch(/upper third of the frame is calm, open backdrop/);
    expect(bottom).toMatch(/lower third of the frame is calm, open space/);
    for (const p of [top, bottom]) {
      expect(p.split("\n").at(-1)).toBe(NO_TEXT);
      expect(p).not.toMatch(/camera/i);
    }
  });

  it("Random age: a child of its own, the same every time for the post", () => {
    const a = planCoverCard({ ...base, age: "random" });
    expect(planCoverCard({ ...base, age: "random" })).toEqual(a);
    expect(a.prompt).toMatch(/^Professional studio/);
  });

  it("the prompt never says 'album cover' (the model may draw lettering for it)", () => {
    for (const s of SESSIONS) {
      expect(buildCoverPrompt(theme, "girl", { session: s, look: "soft dark hair" }, poses[0], "top")).not.toMatch(/album cover|cover/i);
    }
    expect(planCoverCard(base).prompt).toMatch(/Shot: the opening frame of the session: /);
  });

  it("every pose builds a prompt for every session", () => {
    for (const pose of poses) {
      for (const s of SESSIONS) {
        expect(buildCoverPrompt(theme, "girl", { session: s, look: "soft dark hair, warm tan skin" }, pose, "top")).toContain(pose.moment[s]);
      }
    }
  });

  it("a front card shot is told apart from the other cards' shots", () => {
    expect(COVER_SHOT_PREFIX).toBe("front card");
    expect(coverPoseId("closing card: wide eye-level shot")).toBeNull();
    expect(coverPoseId(null)).toBeNull();
    expect(isCoverShot("close-up portrait of the baby")).toBe(false);
  });
});

describe("withNameOrder", () => {
  it("the names move with what belongs to them; each position keeps its shot, prompt and seed", () => {
    const cards = ["A", "B", "C", "D"].map((n, k) => ({ position: k + 1, name_id: `id${n}`, name: n, meaning: `m${n}`, source: `src${n}`, shot: `s${k}`, prompt: `p${k}`, seed: k }));
    const out = withNameOrder(cards, [2, 0, 3, 1]);
    expect(out.map((c) => [c.position, c.name, c.name_id, c.meaning, c.source, c.shot, c.prompt, c.seed])).toEqual([
      [1, "C", "idC", "mC", "srcC", "s0", "p0", 0], [2, "A", "idA", "mA", "srcA", "s1", "p1", 1],
      [3, "D", "idD", "mD", "srcD", "s2", "p2", 2], [4, "B", "idB", "mB", "srcB", "s3", "p3", 3],
    ]);
    expect(withNameOrder(cards, [0, 1, 2, 3])).toEqual(cards);
  });
});
