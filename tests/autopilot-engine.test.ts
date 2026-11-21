import { describe, expect, it, vi } from "vitest";
import type { AutopilotItemRow, AutopilotRunRow, CardRow } from "@/lib/db/types";
import { memoryRepo } from "./helpers/autopilot-memory";
import { MAX_REMAKES, WAIT_COMFY, tick, type EngineDeps } from "@/lib/autopilot/engine";
import { runCost, summarize } from "@/lib/autopilot/summary";

const NOW = Date.parse("2026-11-20T03:00:00Z");
const run = (o: Partial<AutopilotRunRow> = {}): AutopilotRunRow => ({ id: "run1", status: "running", days: 1, first_day: "2026-11-21", message: null, events: [],
  input_tokens: 0, output_tokens: 0, tick_until: null, created_at: "", finished_at: null, updated_at: "", ...o });
const item = (id: string, o: Partial<AutopilotItemRow> = {}): AutopilotItemRow => ({ id, run_id: "run1", day: "2026-11-21", slot: "morning", gender: "girl",
  scheduled_for: "2026-11-21T01:12:00Z", letter: "S", name_theme: null, name_count: 10, post_id: null, state: "planned", lookalike_done: false, attempts: 0,
  note: null, created_at: "", updated_at: "", ...o });
const card = (id: string, o: Partial<CardRow> = {}): CardRow => ({ id, post_id: "p1", theme_id: "t", kind: "post", position: 1, name_id: null, name: id, meaning: "m",
  shot: "s", prompt: "p", seed: 1, status: "done", error: null, photo_path: "x", card_path: `cards/${id}.jpg`, version: 1, selected: true, order_index: 1,
  queued_at: "", claimed_at: null, started_at: null, finished_at: null, attempts: 0, created_at: "", updated_at: "", check_state: "pending", check_note: null, remakes: 0, ...o });
const usage = { input: 1000, output: 100 };
const pass = { ok: true as const, data: { pass: true, problems: [], note: "" }, usage };
const fail = (p: "hands" | "skin") => ({ ok: true as const, data: { pass: false, problems: [p], note: "" }, usage });

function setup(o: Parameters<typeof memoryRepo>[0] = {}, deps: Partial<EngineDeps> = {}) {
  const m = memoryRepo({ runs: [run()], ...o });
  const d: EngineDeps = {
    repo: m.repo,
    pickNames: vi.fn(async () => ({ kind: "ok" as const, nameIds: Array.from({ length: 10 }, (_, i) => `n${i}`), usage, added: ["Saria"], skipped: [{ name: "Sqig", why: "made up" }] })),
    createPost: vi.fn(async () => ({ ok: true as const, postId: "p1" })),
    schedule: vi.fn(async () => ({ ok: true as const, state: "scheduled" as const, permalink: null, scheduledFor: "x" })),
    remake: vi.fn(async (c: CardRow, extra: Partial<CardRow>) => { Object.assign(m.db.cards.find((x) => x.id === c.id)!, { ...extra, status: "queued" }); return true; }),
    judgeCard: vi.fn(async () => pass),
    judgeLookAlike: vi.fn(async () => ({ ok: true as const, data: [] as number[], usage })),
    now: () => NOW,
    ...deps,
  };
  return { m, d };
}
const tenCards = (o: Partial<CardRow> = {}) => Array.from({ length: 10 }, (_, i) => card(`c${i}`, o));

describe("tick", () => {
  it("does nothing without an active run, while another tick works, or while paused", async () => {
    expect(await tick(setup({ runs: [] }).d)).toEqual({ ran: false, why: "no-run" });
    expect(await tick(setup({ runs: [run({ tick_until: "2026-11-20T03:04:00.000Z" })] }).d)).toEqual({ ran: false, why: "busy" });
    expect(await tick(setup({ runs: [run({ status: "paused" })] }).d)).toEqual({ ran: false, why: "paused" });
  });

  it("plans the next post: names, the post (item id as request id), cards marked for checking", async () => {
    const { m, d } = setup({ items: [item("i1", { name_theme: null }), item("i2", { slot: "afternoon", gender: "boy", scheduled_for: "2026-11-21T05:40:00Z" })], cards: tenCards({ check_state: null }) });
    expect(await tick(d)).toEqual({ ran: true, status: "running" });
    expect(d.createPost).toHaveBeenCalledWith(expect.objectContaining({ gender: "girl", style: "single", count: null, postDate: "2026-11-21", requestId: "i1",
      subjectAge: "random", letter: "S", nameIds: expect.any(Array), nameTheme: null }));
    expect(m.db.items[0]).toMatchObject({ state: "making", post_id: "p1", attempts: 1 });
    expect(m.db.cards.every((c) => c.check_state === "pending")).toBe(true);
    expect(m.db.runs[0].events.map((e) => e.kind)).toEqual(["name_added", "name_skipped"]);
    expect(m.db.runs[0].input_tokens).toBe(1000);
    expect(m.db.runs[0].tick_until).toBeNull();
  });

  it("the names step's notes (meanings fixed, skips held back) are logged as run events", async () => {
    const notes = ["Meaning fixed for Selah: pause → a pause to reflect", "Autopilot left 5 names alone that it would have skipped: please look at them (A, B, C, D, E)."];
    const { m, d } = setup({ items: [item("i1")] }, { pickNames: vi.fn(async () => ({ kind: "ok" as const, nameIds: ["n0"], usage, added: [], skipped: [], notes })) });
    await tick(d);
    expect(m.db.runs[0].events.filter((e) => e.kind === "run").map((e) => e.text)).toEqual(notes);
  });

  it("a name-theme post gets its title and the hint from the settings", async () => {
    const { d } = setup({ items: [item("i1", { letter: null, name_theme: "Biblical" })] });
    await tick(d);
    expect(d.pickNames).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }), "names from the Bible", expect.any(Number));
    expect(d.createPost).toHaveBeenCalledWith(expect.objectContaining({ nameTheme: { title: "Biblical", hint: "names from the Bible" } }));
  });

  it("with the PC not ready it waits: no new posts, but finished cards are still checked", async () => {
    const { m, d } = setup({ health: "comfy-off", items: [item("i1", { state: "making", post_id: "p1" }), item("i2")], cards: [card("c0"), card("c1", { status: "queued" })] });
    expect(await tick(d)).toEqual({ ran: true, status: "waiting" });
    expect(m.db.runs[0].message).toBe(WAIT_COMFY);
    expect(d.createPost).not.toHaveBeenCalled();
    expect(m.db.cards[0].check_state).toBe("passed");
  });

  it("checks cards: pass, fail -> remade (up to 2), then removed and unselected", async () => {
    const judgeCard = vi.fn(async (c: CardRow) => (c.id === "c0" ? pass : fail("hands")));
    const { m, d } = setup({ items: [item("i1", { state: "making", post_id: "p1" })],
      cards: [card("c0"), card("c1"), card("c2", { remakes: MAX_REMAKES, check_note: "Remade: odd hands or fingers" })] }, { judgeCard });
    await tick(d);
    const [c0, c1, c2] = m.db.cards;
    expect(c0).toMatchObject({ check_state: "passed", check_note: "Checked" });
    expect(d.remake).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), { check_state: "pending", check_note: "Remade: odd hands or fingers", remakes: 1 });
    expect(c2).toMatchObject({ check_state: "removed", selected: false, check_note: "Removed: odd hands or fingers" });
    expect(m.db.runs[0].events.map((e) => e.kind)).toEqual(["card_remade", "card_removed"]);
  });

  it("a card the PC could not make is remade like a failed check", async () => {
    const { d } = setup({ items: [item("i1", { state: "making", post_id: "p1" })], cards: [card("c0", { status: "failed" })] });
    await tick(d);
    expect(d.remake).toHaveBeenCalledWith(expect.objectContaining({ id: "c0" }), expect.objectContaining({ check_note: "Remade: the PC could not make it" }));
  });

  it("could not check: remade once, then the post is held", async () => {
    const judgeCard = vi.fn(async () => ({ ok: false as const, error: "Claude timed out.", usage, stop: false }));
    const { m, d } = setup({ items: [item("i1", { state: "making", post_id: "p1" })], cards: [card("c0")] }, { judgeCard });
    await tick(d);
    expect(m.db.cards[0]).toMatchObject({ check_state: "pending", check_note: "Could not check: Claude timed out.", remakes: 1 });
    Object.assign(m.db.cards[0], { status: "done" });
    m.db.runs[0].tick_until = null;
    await tick(d);
    expect(m.db.cards[0].check_state).toBe("failed");
    expect(m.db.items[0]).toMatchObject({ state: "held", note: "A card could not be checked. Look at the post, then schedule it yourself." });
  });

  it("a Claude stop (credits, key) pauses the run with the reason", async () => {
    const judgeCard = vi.fn(async () => ({ ok: false as const, error: "Your Claude credits have run out.", usage, stop: true }));
    const { m, d } = setup({ items: [item("i1", { state: "making", post_id: "p1" })], cards: [card("c0")] }, { judgeCard });
    expect(await tick(d)).toEqual({ ran: true, status: "paused" });
    expect(m.db.runs[0].message).toBe("Your Claude credits have run out. Fix it, then press Resume.");
  });

  it("all cards passed: one look-alike check, remakes it names, then schedules at the planned time", async () => {
    const judgeLookAlike = vi.fn(async () => ({ ok: true as const, data: [3], usage }));
    const { m, d } = setup({ items: [item("i1", { state: "checking", post_id: "p1" })], cards: tenCards({ check_state: "passed" }) }, { judgeLookAlike });
    await tick(d);
    expect(d.remake).toHaveBeenCalledWith(expect.objectContaining({ id: "c2" }), { check_state: "pending", check_note: "Remade: looked like another card", remakes: 1 });
    expect(m.db.items[0]).toMatchObject({ lookalike_done: true, state: "making" });
    expect(d.schedule).not.toHaveBeenCalled();
    Object.assign(m.db.cards[2], { status: "done" });
    m.db.runs[0].tick_until = null;
    expect(await tick(d)).toEqual({ ran: true, status: "done" }); // its only post is scheduled: the run is finished
    expect(judgeLookAlike).toHaveBeenCalledTimes(1);
    expect(d.schedule).toHaveBeenCalledWith("p1", "2026-11-21T01:12:00Z");
    expect(m.db.items[0].state).toBe("scheduled");
    expect(m.db.runs[0].finished_at).toBeTruthy();
    expect(await tick(d)).toEqual({ ran: false, why: "no-run" });
  });

  it("holds a post with fewer than 8 passed name cards, or one ready too late", async () => {
    const { m, d } = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards: tenCards({ check_state: "passed" }).map((c, i) => (i < 3 ? { ...c, check_state: "removed" as const } : c)) });
    await tick(d);
    expect(m.db.items[0]).toMatchObject({ state: "held", note: expect.stringMatching(/^Only 7 name cards passed/) });
    const late = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true, scheduled_for: "2026-11-20T03:10:00Z" })], cards: tenCards({ check_state: "passed" }) });
    await tick(late.d);
    expect(late.m.db.items[0]).toMatchObject({ state: "held", note: expect.stringMatching(/ready too late/) });
    expect(late.d.schedule).not.toHaveBeenCalled();
  });

  it("a Facebook key problem pauses the run; another Facebook error holds that post", async () => {
    const auth = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards: tenCards({ check_state: "passed" }) },
      { schedule: vi.fn(async () => ({ ok: false as const, error: "Facebook no longer accepts the app's key.", errorKind: "auth" as const })) });
    expect(await tick(auth.d)).toEqual({ ran: true, status: "paused" });
    const other = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards: tenCards({ check_state: "passed" }) },
      { schedule: vi.fn(async () => ({ ok: false as const, error: "Facebook refused: x", errorKind: "other" as const })) });
    await tick(other.d);
    expect(other.m.db.items[0]).toMatchObject({ state: "held", note: "Facebook refused: x" });
  });

  it("names: hold, retry (3 tries), no theme left", async () => {
    const hold = setup({ items: [item("i1")] }, { pickNames: vi.fn(async () => ({ kind: "hold" as const, why: "Only 5 good girl names", usage, added: [], skipped: [] })) });
    await tick(hold.d);
    expect(hold.m.db.items[0]).toMatchObject({ state: "held", note: "Only 5 good girl names" });
    const retry = setup({ items: [item("i1", { attempts: 2 })] }, { pickNames: vi.fn(async () => ({ kind: "retry" as const, error: "Claude timed out.", usage, added: [], skipped: [] })) });
    await tick(retry.d);
    expect(retry.m.db.items[0]).toMatchObject({ state: "held", note: "Couldn't pick names: Claude timed out." });
    const noTheme = setup({ items: [item("i1")], themesLeft: { girl: 0 } });
    await tick(noTheme.d);
    expect(noTheme.m.db.items[0]).toMatchObject({ state: "held", note: expect.stringMatching(/No girl photoshoot theme/) });
    expect(noTheme.d.pickNames).not.toHaveBeenCalled();
  });

  it("an item already at 3 naming tries (a tick died while picking names) is held without picking names again", async () => {
    for (const state of ["naming", "planned"] as const) {
      const { m, d } = setup({ items: [item("i1", { state, attempts: 3 })] });
      await tick(d);
      expect(d.pickNames).not.toHaveBeenCalled();
      expect(d.createPost).not.toHaveBeenCalled();
      expect(m.db.items[0]).toMatchObject({ state: "held", attempts: 3, note: "Couldn't pick names after 3 tries. Make this post on Today." });
    }
  });

  it("at most two posts are being made at once", async () => {
    // (each post has a card still being made: a post with no cards at all is held, see below)
    const { d } = setup({ items: [item("a", { state: "making", post_id: "pa" }), item("b", { state: "making", post_id: "pb" }), item("c")],
      cards: [card("ca", { post_id: "pa", status: "queued" }), card("cb", { post_id: "pb", status: "queued" })] });
    await tick(d);
    expect(d.pickNames).not.toHaveBeenCalled();
  });

  it("a deleted post (no post id) or a post with no cards is held, and the run can finish", async () => {
    const gone = setup({ items: [item("i1", { state: "making", post_id: null })] });
    expect(await tick(gone.d)).toEqual({ ran: true, status: "done" });
    expect(gone.m.db.items[0]).toMatchObject({ state: "held", note: "The post was deleted. Make it on Today if you still want it." });
    const empty = setup({ items: [item("i1", { state: "making", post_id: "p1" })] });
    await tick(empty.d);
    expect(empty.m.db.items[0]).toMatchObject({ state: "held", note: "The post has no cards left. Make it on Today if you still want it." });
  });

  it("a selected card with no check state is checked first; nothing is scheduled before it passes", async () => {
    const judgeCard = vi.fn(async () => fail("skin"));
    const cards = [...tenCards({ check_state: "passed" }), card("late", { check_state: null, position: 11 })];
    const { m, d } = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards }, { judgeCard });
    await tick(d);
    expect(judgeCard).toHaveBeenCalledTimes(1);
    expect(m.db.cards.find((c) => c.id === "late")).toMatchObject({ check_state: "pending", remakes: 1 });
    expect(d.schedule).not.toHaveBeenCalled();
    // Unselected cards are not checked and do not block.
    const un = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards: [...tenCards({ check_state: "passed" }), card("off", { check_state: null, selected: false })] });
    await tick(un.d);
    expect(un.d.schedule).toHaveBeenCalled();
  });

  it("Stop pressed while names are picked: the post is not made", async () => {
    const st = setup({ items: [item("i1")] });
    st.d.pickNames = vi.fn(async () => { st.m.db.runs[0].status = "stopped"; return { kind: "ok" as const, nameIds: ["n0"], usage, added: [], skipped: [] }; });
    expect(await tick(st.d)).toEqual({ ran: true, status: "stopped" });
    expect(st.d.createPost).not.toHaveBeenCalled();
  });

  it("a tick that died after the post was made is finished by the next: no names picked twice", async () => {
    // Variant 1: the item could not be saved after createPost; the next tick adopts the post by its request id.
    const a = setup({ items: [item("i1")], cards: tenCards({ check_state: null }) });
    a.d.createPost = vi.fn(async () => { a.m.db.requestPosts["i1"] = "p1"; return { ok: true as const, postId: "p1" }; });
    const realUpdate = a.m.repo.updateItem;
    let failOnce = true;
    a.m.repo.updateItem = async (id, patch) => { if (failOnce && patch.state === "making") { failOnce = false; throw new Error("db down"); } return realUpdate(id, patch); };
    await tick(a.d);
    expect(a.m.db.items[0].state).toBe("naming");
    expect(a.d.pickNames).toHaveBeenCalledTimes(1);
    await tick(a.d);
    expect(a.d.pickNames).toHaveBeenCalledTimes(1);
    expect(a.m.db.items[0]).toMatchObject({ state: "making", post_id: "p1" });
    expect(a.m.db.cards.every((c) => c.check_state === "pending")).toBe(true);
    // Variant 2: marking the cards failed after the item was saved; the next tick marks them and carries on.
    const b = setup({ items: [item("i1")], cards: tenCards({ check_state: null }) });
    const realMark = b.m.repo.markCardsPending;
    let once = true;
    b.m.repo.markCardsPending = async (id) => { if (once) { once = false; throw new Error("db down"); } return realMark(id); };
    await tick(b.d);
    expect(b.m.db.items[0]).toMatchObject({ state: "making", post_id: "p1" });
    await tick(b.d);
    expect(b.d.pickNames).toHaveBeenCalledTimes(1);
    expect(b.m.db.cards.every((c) => c.check_state !== null)).toBe(true);
  });

  it("an unexpected error: a plain event, the lock is freed, the status is unchanged", async () => {
    const { m, d } = setup({ items: [item("i1")] });
    m.repo.items = async () => { throw new Error("connection reset by peer 10.0.0.1"); };
    expect(await tick(d)).toEqual({ ran: true, status: "running" });
    expect(m.db.runs[0].tick_until).toBeNull();
    expect(m.db.runs[0].events.map((e) => e.text)).toEqual(["Something went wrong (a database or network hiccup). Autopilot tries again in a moment."]);
  });

  it("could not check, at the remake limit: the card fails (post held); a remake is logged", async () => {
    const judgeCard = vi.fn(async () => ({ ok: false as const, error: "Claude timed out.", usage, stop: false }));
    const { m, d } = setup({ items: [item("i1", { state: "making", post_id: "p1" })], cards: [card("c0", { remakes: MAX_REMAKES }), card("c1")] }, { judgeCard });
    await tick(d);
    expect(m.db.cards[0].check_state).toBe("failed");
    expect(m.db.cards[1].remakes).toBe(1);
    expect(m.db.runs[0].events.filter((e) => e.kind === "card_remade")).toHaveLength(1);
  });

  it("progress is saved mid-tick, and the event trim keeps every counted event", async () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ at: "", kind: i % 2 ? ("name_added" as const) : ("run" as const), text: String(i) }));
    const { m, d } = setup({ runs: [run({ events: many })], items: [item("i1", { state: "making", post_id: "p1" })], cards: [card("c0", { status: "queued" })] });
    const save = vi.spyOn(m.repo, "saveProgress");
    await tick(d);
    expect(save).toHaveBeenCalledTimes(2);
    const ev = m.db.runs[0].events;
    expect(ev.filter((e) => e.kind === "name_added")).toHaveLength(200);
    expect(ev.filter((e) => e.kind === "run").length).toBeLessThanOrEqual(50);
    expect(ev.map((e) => Number(e.text)).filter((n) => !Number.isNaN(n))).toEqual([...ev.map((e) => Number(e.text)).filter((n) => !Number.isNaN(n))].sort((x, y) => x - y));
  });

  it("Stop wins: nothing is scheduled and the run stays stopped", async () => {
    const { m, d } = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards: tenCards({ check_state: "passed" }) });
    const realStatus = m.repo.runStatus;
    m.repo.runStatus = async (id) => { m.db.runs[0].status = "stopped"; return realStatus(id); };
    await tick(d);
    expect(d.schedule).not.toHaveBeenCalled();
    expect(m.db.runs[0].status).toBe("stopped");
    expect(m.db.runs[0].tick_until).toBeNull();
  });

  it("summary and cost", () => {
    const r = run({ input_tokens: 1_000_000, output_tokens: 100_000, events: [
      { at: "", kind: "name_added", text: "" }, { at: "", kind: "card_remade", text: "" }, { at: "", kind: "card_remade", text: "" }, { at: "", kind: "card_removed", text: "" },
    ] });
    expect(runCost(r)).toBeCloseTo(6);
    expect(summarize(r, [item("a", { state: "scheduled" }), item("b", { state: "held" })])).toEqual({ scheduled: 1, held: 1, namesAdded: 1, namesSkipped: 0, remade: 2, removed: 1, costUsd: 6 });
  });
});
