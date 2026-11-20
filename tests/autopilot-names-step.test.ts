import { describe, expect, it, vi } from "vitest";
import { memoryRepo } from "./helpers/autopilot-memory";
import type { RepoName } from "@/lib/autopilot/repo";
import type { NameVerdict } from "@/lib/autopilot/judge-names";
import { pickNames, type NamesDeps } from "@/lib/autopilot/names-step";

const nm = (name: string, o: Partial<RepoName> = {}): RepoName => ({ id: `n-${name}`, name, meaning: "a meaning", gender: "girl", style: "single", status: "available", ...o });
const usage = { input: 10, output: 5 };
/** A judge that passes every name except the ones listed. */
const judgeWith = (bad: Record<string, Partial<NameVerdict>> = {}) => vi.fn(async (i: { names: { name: string; meaning: string }[] }) => ({
  ok: true as const, usage,
  data: i.names.map((n) => ({ name: n.name, good: true, fits: true, reason: "", meaning: n.meaning.toLowerCase(), ...bad[n.name] })),
}));
const item = { gender: "girl" as const, letter: "S", name_theme: null, name_count: 10 };
const S = ["Sabina", "Selah", "Sienna", "Sloane", "Stella", "Sage", "Sora", "Saoirse", "Sylvie", "Seraphina", "Solene", "Sunny"];
const deps = (names: RepoName[], judge: NamesDeps["judge"], suggest?: NamesDeps["suggest"]) => {
  const m = memoryRepo({ names });
  return { m, d: { repo: m.repo, judge, suggest: suggest ?? vi.fn(async () => ({ ok: true as const, names: [] })), rng: () => 0.5 } satisfies NamesDeps };
};

describe("pickNames", () => {
  it("uses the saved names that pass, without asking the AI for more", async () => {
    const { d } = deps([...S.map((n) => nm(n)), nm("Tala"), nm("Sam", { gender: "boy" }), nm("Sky", { status: "used" })], judgeWith());
    const r = await pickNames(d, item, null);
    expect(r.kind).toBe("ok");
    expect(r.kind === "ok" && r.nameIds).toHaveLength(10);
    expect(r.kind === "ok" && r.nameIds.every((id) => S.map((n) => `n-${n}`).includes(id))).toBe(true);
    expect(d.suggest).not.toHaveBeenCalled();
    expect(r.usage).toEqual(usage);
  });

  it("skips saved names a parent would not choose (with the reason), fixes meanings, and leaves names that only don't fit", async () => {
    const { d, m } = deps(S.map((n) => nm(n)), judgeWith({
      Saoirse: { good: false, reason: "hard to say" }, Sylvie: { fits: false, reason: "too close to Sienna" }, Selah: { meaning: "a pause to reflect" },
      Sora: { good: false, fits: false, reason: "not judged" },
    }));
    const r = await pickNames(d, item, null);
    expect(m.db.skipped).toEqual([{ id: "n-Saoirse", note: "Skipped by Autopilot: hard to say" }]);
    expect(m.db.meanings).toEqual([{ id: "n-Selah", meaning: "a pause to reflect" }]);
    expect(r.skipped).toEqual([{ name: "Saoirse", why: "hard to say" }]);
    expect(r.kind === "ok" && r.nameIds).not.toContain("n-Sylvie");
  });

  it("asks the AI for more when short, checks them, saves the good ones and uses them", async () => {
    const suggest = vi.fn(async () => ({ ok: true as const, names: [{ name: "Saria", meaning: "princess" }, { name: "Sqiggle", meaning: "?" }, { name: "Sabina", meaning: "dup" }] }));
    const { d, m } = deps(S.slice(0, 7).map((n) => nm(n)), judgeWith({ Sqiggle: { good: false, reason: "made up" } }), suggest);
    const r = await pickNames(d, { ...item, name_count: 8 }, null);
    expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ gender: "girl", target: { kind: "letter", letter: "S" }, want: 1 + 4 }));
    expect(r.added).toEqual(["Saria"]);
    expect(m.db.names.find((n) => n.name === "Saria")).toMatchObject({ status: "available", meaning: "princess" });
    expect(r.kind === "ok" && r.nameIds).toHaveLength(8);
  });

  it("holds the post when there are still fewer than 8 good names after two extra rounds", async () => {
    const suggest = vi.fn(async () => ({ ok: true as const, names: [] }));
    const { d } = deps(S.slice(0, 5).map((n) => nm(n)), judgeWith(), suggest);
    const r = await pickNames(d, item, null);
    expect(suggest).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ kind: "hold", why: "Only 5 good girl names for letter S (8 needed). Add names, then make this post on Today." });
  });

  it("goes ahead with 8 or more when it can't reach the target", async () => {
    const { d } = deps(S.slice(0, 9).map((n) => nm(n)), judgeWith());
    const r = await pickNames(d, { ...item, name_count: 12 }, null);
    expect(r.kind === "ok" && r.nameIds).toHaveLength(9);
  });

  it("a name-theme post judges every saved name of the gender for fit, with the hint", async () => {
    const judge = judgeWith({ Stella: { fits: false, reason: "not biblical" } });
    const { d, m } = deps([nm("Ruth"), nm("Stella"), nm("Ezra", { gender: "boy" })], judge);
    await pickNames(d, { gender: "girl", letter: null, name_theme: "Biblical", name_count: 10 }, "names from the Bible");
    expect(judge.mock.calls[0][0]).toMatchObject({ target: { kind: "theme", title: "Biblical", hint: "names from the Bible" } });
    expect(judge.mock.calls[0][0].names.map((n: { name: string }) => n.name)).toEqual(["Ruth", "Stella"]);
    expect(m.db.skipped).toEqual([]);
  });

  it("a name-theme post judges at most 60 saved names, all from the stock", async () => {
    const stock = Array.from({ length: 70 }, (_, i) => nm(`Name${i}`));
    const judge = judgeWith();
    const { d } = deps(stock, judge);
    await pickNames(d, { gender: "girl", letter: null, name_theme: "Biblical", name_count: 10 }, null);
    const sent: string[] = judge.mock.calls[0][0].names.map((n: { name: string }) => n.name);
    expect(sent).toHaveLength(60);
    expect(sent.every((n) => stock.some((s) => s.name === n))).toBe(true);
    expect(new Set(sent).size).toBe(60);
  });

  it("retries (does not hold) when the AI could not suggest names and the post is short", async () => {
    const suggest = vi.fn(async () => ({ ok: false as const, error: "Claude timed out." }));
    const { d } = deps(S.slice(0, 5).map((n) => nm(n)), judgeWith(), suggest);
    expect(await pickNames(d, item, null)).toMatchObject({ kind: "retry", error: "Claude timed out." });
    expect(suggest).toHaveBeenCalledTimes(2);
  });

  it("an AI stop (credits, key) stops; any other AI failure is retried later", async () => {
    const stop = vi.fn(async () => ({ ok: false as const, error: "Your Claude credits have run out.", usage, stop: true }));
    expect(await pickNames(deps(S.map((n) => nm(n)), stop).d, item, null)).toMatchObject({ kind: "stop" });
    const flaky = vi.fn(async () => ({ ok: false as const, error: "Claude timed out.", usage, stop: false }));
    expect(await pickNames(deps(S.map((n) => nm(n)), flaky).d, item, null)).toMatchObject({ kind: "retry", error: "Claude timed out." });
  });

  it("with little time left before the deadline it skips the extra AI round and asks to retry", async () => {
    const { d } = deps(S.slice(0, 5).map((n) => nm(n)), judgeWith());
    const r = await pickNames({ ...d, now: () => 1_000_000 }, item, null, 1_000_000 + 99_000);
    expect(d.suggest).not.toHaveBeenCalled();
    expect(r).toMatchObject({ kind: "retry", error: "Ran out of time picking names; trying again." });
    // With enough time the round runs as before.
    await pickNames({ ...d, now: () => 1_000_000 }, item, null, 1_000_000 + 200_000);
    expect(d.suggest).toHaveBeenCalled();
  });
});
