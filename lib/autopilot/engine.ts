// One Autopilot tick (spec "A tick"): bounded, under a lock, safe to repeat. 1) check the cards the PC finished,
// 2) finish posts whose cards all passed (look-alike, then schedule or hold), 3) plan the next post when there is room,
// 4) finish the run. Errors that need the owner (Claude credits or key, Facebook key) pause the run.
import type { ActionResult } from "@/lib/actions/result";
import type { AutopilotEvent, AutopilotEventKind, AutopilotItemRow, AutopilotRunRow, AutopilotRunStatus, CardRow } from "@/lib/db/types";
import type { CreatePostInput } from "@/lib/posts/create";
import type { PublishResult } from "@/lib/facebook/publish";
import { CARD_CHANGED_AFTER_CHECK, manilaLabel } from "@/lib/facebook/schedule";
import type { JudgeResult, Usage } from "./claude-judge";
import type { NamesOutcome } from "./names-step";
import type { AutopilotRepo } from "./repo";
import { PROBLEM_LABEL, type PhotoVerdict } from "./photo-problems";
import { MIN_GOOD_NAMES, dayLabel, labelText } from "./plan";
import { parseNameThemes } from "./name-themes";

export interface EngineDeps {
  repo: AutopilotRepo;
  pickNames: (item: AutopilotItemRow, hint: string | null, deadline?: number) => Promise<NamesOutcome>;
  createPost: (input: CreatePostInput) => Promise<ActionResult<{ postId: string }>>;
  schedule: (postId: string, at: string) => Promise<PublishResult>;
  remake: (card: CardRow, extra: Partial<CardRow>) => Promise<boolean>;
  judgeCard: (card: CardRow, url: string) => Promise<JudgeResult<PhotoVerdict>>;
  judgeLookAlike: (cards: { card: CardRow; url: string }[]) => Promise<JudgeResult<number[]>>;
  now: () => number;
}

export const TICK_LOCK_MS = 5 * 60_000;
/** Work stops starting new steps after this (the route may run up to 300 s). */
export const TICK_BUDGET_MS = 240_000;
/** Picking names (Claude + AI suggestions) needs about this much time left. */
export const NAMING_NEEDS_MS = 150_000;
export const MAX_REMAKES = 2;
export const TOO_LATE_MS = 20 * 60_000;
/** A post not started this long before its time is held (it would not be ready in time). */
export const PLAN_TOO_LATE_MS = 45 * 60_000;
export const CHECKS_AT_ONCE = 6;
export const MAX_NAMING_ATTEMPTS = 3;
/** Kept for callers; the event trim keeps every counted event and only the last MAX_RUN_EVENTS "run" events. */
export const MAX_EVENTS = 300;
export const MAX_RUN_EVENTS = 50;
/** A card-check batch starts only with this much time left; the look-alike check needs more (it can take 150 s). */
export const CHECK_NEEDS_MS = 95_000;
export const LOOKALIKE_NEEDS_MS = 155_000;
const POST_DELETED = "The post was deleted. Make it on Today if you still want it.";
const NO_CARDS = "The post has no cards left. Make it on Today if you still want it.";
export const LOOKALIKE_MAX = 3;
export const WAIT_PC = "Waiting for your PC: turn it on. Autopilot carries on when it's back.";
export const WAIT_COMFY = "Waiting for ComfyUI: open ComfyUI Desktop on your PC.";
const COULD_NOT_CHECK = "Could not check";

export type TickOutcome = { ran: false; why: "no-run" | "busy" | "paused" } | { ran: true; status: AutopilotRunStatus };

/** A reason to pause the run (the owner must fix something). */
class Pause extends Error {}

const itemLabel = (i: AutopilotItemRow) => `${dayLabel(i.day)} · ${labelText(i)} · ${i.gender}`;
const cardName = (c: CardRow) => (c.kind === "cta" ? "the closing card" : c.name);

export async function tick(d: EngineDeps): Promise<TickOutcome> {
  const start = d.now();
  const run = await d.repo.activeRun();
  if (!run) return { ran: false, why: "no-run" };
  if (run.status === "paused") return { ran: false, why: "paused" };
  if (!(await d.repo.lockRun(run.id, new Date(start + TICK_LOCK_MS).toISOString(), new Date(start).toISOString()))) return { ran: false, why: "busy" };
  const t = new Tick(d, run, start);
  try {
    await t.run();
  } catch (e) {
    if (e instanceof Pause) {
      t.status = "paused";
      t.message = e.message;
    } else {
      console.error("autopilot tick", e);
      t.event("run", "Something went wrong (a database or network hiccup). Autopilot tries again in a moment.");
    }
  } finally {
    await t.save();
  }
  return { ran: true, status: t.status };
}

class Tick {
  status: AutopilotRunStatus;
  message: string | null;
  private events: AutopilotEvent[];
  private usage: Usage = { input: 0, output: 0 };
  private items: AutopilotItemRow[] = [];
  private cards: CardRow[] = [];
  private finished: string | null = null;
  /** Stop was pressed: do nothing further this tick. */
  private halted = false;

  constructor(private d: EngineDeps, private runRow: AutopilotRunRow, private start: number) {
    this.status = runRow.status;
    this.message = runRow.message;
    this.events = [...(runRow.events ?? [])];
  }

  event(kind: AutopilotEventKind, text: string) { this.events.push({ at: new Date(this.d.now()).toISOString(), kind, text }); }
  private addUsage(u: Usage) { this.usage.input += u.input; this.usage.output += u.output; }
  private left() { return TICK_BUDGET_MS - (this.d.now() - this.start); }
  private async setItem(item: AutopilotItemRow, patch: Partial<AutopilotItemRow>) { Object.assign(item, patch); await this.d.repo.updateItem(item.id, patch); }
  private async setCard(c: CardRow, patch: Partial<CardRow>) { Object.assign(c, patch); await this.d.repo.updateCard(c.id, patch); }
  private async hold(item: AutopilotItemRow, why: string) {
    await this.setItem(item, { state: "held", note: why.slice(0, 500) });
    this.event("post_held", `${itemLabel(item)}: held. ${why}`);
  }
  private itemOf(c: CardRow) { return this.items.find((i) => i.post_id === c.post_id)!; }
  private active() { return this.items.filter((i) => i.post_id && (i.state === "making" || i.state === "checking")); }
  private async stopped() {
    if (this.halted) return true;
    if ((await this.d.repo.runStatus(this.runRow.id)) !== "stopped") return false;
    this.status = "stopped";
    this.halted = true;
    return true;
  }
  /** Remake a card unless Stop was pressed. */
  private async remakeCard(c: CardRow, extra: Partial<CardRow>) {
    if (await this.stopped()) return false;
    return this.d.remake(c, extra);
  }
  private trimmed() {
    let runs = 0;
    const keep = new Array<boolean>(this.events.length);
    for (let i = this.events.length - 1; i >= 0; i--) keep[i] = this.events[i].kind !== "run" || ++runs <= MAX_RUN_EVENTS;
    return this.events.filter((_, i) => keep[i]);
  }
  private tokens() { return { input_tokens: this.runRow.input_tokens + this.usage.input, output_tokens: this.runRow.output_tokens + this.usage.output }; }
  /** Save events and tokens part-way, so a killed tick keeps what it did. */
  private async progress() { await this.d.repo.saveProgress(this.runRow.id, { events: this.trimmed(), ...this.tokens() }); }

  async run() {
    this.items = await this.d.repo.items(this.runRow.id);
    const health = await this.d.repo.pcHealth(this.start);
    this.status = health === "ready" ? "running" : "waiting";
    this.message = health === "ready" ? null : health === "comfy-off" ? WAIT_COMFY : WAIT_PC;
    await this.checkCards();
    await this.progress();
    if (!this.halted) await this.finishPosts();
    await this.progress();
    if (this.status === "running") await this.planNext();
    // stopped() may have set "stopped" during the steps above; TypeScript's narrowing cannot see that.
    if ((this.status as AutopilotRunStatus) !== "stopped" && this.items.length && this.items.every((i) => i.state === "scheduled" || i.state === "held")) {
      this.status = "done";
      this.message = null;
      this.finished = new Date(this.d.now()).toISOString();
      this.event("run", `Finished: ${this.items.filter((i) => i.state === "scheduled").length} of ${this.items.length} posts scheduled.`);
    }
  }

  async save() {
    await this.d.repo.finishTick(this.runRow.id, {
      status: this.status, message: this.message, events: this.trimmed(), ...this.tokens(),
      ...(this.finished ? { finished_at: this.finished } : {}),
    });
  }

  // 1. Cards
  private async checkCards() {
    const items = this.active();
    if (!items.length) return;
    this.cards = (await this.d.repo.cards(items.map((i) => i.post_id!))).filter((c) => c.selected);
    // A card added after the post was made (check_state empty), or one the owner selected again after Autopilot removed
    // it, is checked like the others: nothing is scheduled with a card that is not checked.
    for (const c of this.cards.filter((x) => !x.check_state || x.check_state === "removed")) await this.setCard(c, { check_state: "pending" });
    for (const c of this.cards.filter((x) => x.check_state === "pending" && x.status === "failed")) {
      if (this.halted) return;
      await this.failCard(c, "the PC could not make it");
    }
    const ready = this.cards.filter((c) => c.check_state === "pending" && c.status === "done" && c.card_path);
    for (let i = 0; i < ready.length && this.left() > CHECK_NEEDS_MS && !this.halted; i += CHECKS_AT_ONCE) {
      const batch = ready.slice(i, i + CHECKS_AT_ONCE);
      const urls = await this.d.repo.signedUrls(batch.map((c) => c.card_path!));
      const results = await Promise.all(batch.map((c, k) => this.d.judgeCard(c, urls[k])));
      for (const r of results) this.addUsage(r.usage);
      for (const [k, r] of results.entries()) {
        const c = batch[k];
        if (this.halted) return;
        if (!r.ok) {
          if (r.stop) throw new Pause(`${r.error} Fix it, then press Resume.`);
          await this.couldNotCheck(c, r.error);
        } else if (r.data.pass) {
          const note = (c.remakes ?? 0) && c.check_note?.startsWith("Remade:") ? c.check_note : "Checked";
          await this.setCard(c, { check_state: "passed", check_note: note });
        } else {
          await this.failCard(c, r.data.problems.map((p) => PROBLEM_LABEL[p]).join(", "));
        }
      }
    }
  }

  private async failCard(c: CardRow, why: string) {
    const item = this.itemOf(c);
    const remakes = c.remakes ?? 0;
    if (remakes < MAX_REMAKES) {
      const extra = { check_state: "pending" as const, check_note: `Remade: ${why}`.slice(0, 300), remakes: remakes + 1 };
      if (await this.remakeCard(c, extra)) {
        Object.assign(c, extra, { status: "queued" });
        this.event("card_remade", `${itemLabel(item)}: ${cardName(c)} remade (${why}).`);
      }
      return;
    }
    await this.setCard(c, { check_state: "removed", check_note: `Removed: ${why}`.slice(0, 300), selected: false });
    this.event("card_removed", `${itemLabel(item)}: ${cardName(c)} removed after ${MAX_REMAKES} remakes (${why}).`);
  }

  private async couldNotCheck(c: CardRow, error: string) {
    const remakes = c.remakes ?? 0;
    if (c.check_note?.startsWith(COULD_NOT_CHECK) || remakes >= MAX_REMAKES) {
      await this.setCard(c, { check_state: "failed", check_note: `${COULD_NOT_CHECK} twice: ${error}`.slice(0, 300) });
      return;
    }
    const extra = { check_state: "pending" as const, check_note: `${COULD_NOT_CHECK}: ${error}`.slice(0, 300), remakes: remakes + 1 };
    if (await this.remakeCard(c, extra)) {
      Object.assign(c, extra, { status: "queued" });
      this.event("card_remade", `${itemLabel(this.itemOf(c))}: ${cardName(c)} remade (could not check it: ${error}).`);
    }
  }

  // 2. Posts
  private async finishPosts() {
    // The owner deleted the post (the item keeps no post id): nothing is left to check.
    for (const item of this.items.filter((i) => !i.post_id && (i.state === "making" || i.state === "checking"))) await this.hold(item, POST_DELETED);
    for (const item of this.active()) {
      if (this.halted) return;
      const cs = this.cards.filter((c) => c.post_id === item.post_id);
      if (!cs.length) {
        await this.hold(item, NO_CARDS);
        continue;
      }
      const open = cs.filter((c) => c.check_state === "pending");
      if (open.length) {
        const state = open.every((c) => c.status === "done") ? "checking" : "making";
        if (item.state !== state) await this.setItem(item, { state });
        continue;
      }
      if (cs.some((c) => c.check_state === "failed")) {
        await this.hold(item, "A card could not be checked. Look at the post, then schedule it yourself.");
        continue;
      }
      const passed = cs.filter((c) => c.check_state === "passed");
      const names = passed.filter((c) => c.kind === "post").length;
      if (names < MIN_GOOD_NAMES) {
        await this.hold(item, `Only ${names} name cards passed the checks (${MIN_GOOD_NAMES} needed). Remake or add cards, then schedule it yourself.`);
        continue;
      }
      // Nothing is scheduled with a card that is not checked (removed cards are not posted).
      if (cs.some((c) => c.check_state !== "passed" && c.check_state !== "removed")) continue;
      if (!item.lookalike_done) {
        if (this.left() < LOOKALIKE_NEEDS_MS) continue;
        const remade = await this.lookAlike(item, passed);
        await this.setItem(item, { lookalike_done: true, ...(remade ? { state: "making" as const } : {}) });
        if (remade || this.halted) continue;
      }
      if (Date.parse(item.scheduled_for) - this.d.now() < TOO_LATE_MS) {
        await this.hold(item, `It was ready too late for ${manilaLabel(item.scheduled_for)}. Schedule or post it yourself.`);
        continue;
      }
      if (await this.stopped()) return;
      const r = await this.d.schedule(item.post_id!, item.scheduled_for);
      if (r.ok) {
        await this.setItem(item, { state: "scheduled", note: null });
        this.event("post_scheduled", `${itemLabel(item)}: scheduled for ${manilaLabel(item.scheduled_for)}.`);
      } else if (r.error === CARD_CHANGED_AFTER_CHECK) {
        // The owner changed a card after this tick read it: the next tick sees it pending and checks it again.
        continue;
      } else if (r.errorKind === "auth" || r.errorKind === "not_connected") {
        throw new Pause(`${r.error} Then press Resume.`);
      } else {
        await this.hold(item, r.error);
      }
    }
  }

  private async lookAlike(item: AutopilotItemRow, passed: CardRow[]): Promise<boolean> {
    const urls = await this.d.repo.signedUrls(passed.map((c) => c.card_path!));
    const r = await this.d.judgeLookAlike(passed.map((card, k) => ({ card, url: urls[k] })));
    this.addUsage(r.usage);
    if (!r.ok) {
      if (r.stop) throw new Pause(`${r.error} Fix it, then press Resume.`);
      this.event("run", `${itemLabel(item)}: the look-alike check was skipped (${r.error}).`);
      return false;
    }
    let remade = false;
    for (const n of r.data.slice(0, LOOKALIKE_MAX)) {
      const c = passed[n - 1];
      if (!c) continue;
      const extra = { check_state: "pending" as const, check_note: "Remade: looked like another card", remakes: (c.remakes ?? 0) + 1 };
      if (await this.remakeCard(c, extra)) {
        Object.assign(c, extra, { status: "queued" });
        remade = true;
        this.event("card_remade", `${itemLabel(item)}: ${cardName(c)} remade (looked like another card).`);
      }
    }
    return remade;
  }

  // 3. The next post
  private async planNext() {
    if (this.left() < NAMING_NEEDS_MS) return;
    if (this.items.filter((i) => i.state === "making" || i.state === "checking").length > 1) return;
    const next = this.items.filter((i) => i.state === "planned" || i.state === "naming").sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))[0];
    if (!next) return;
    // A tick that died after making the post: take the post it made instead of picking names again.
    if (next.state === "naming") {
      const existing = await this.d.repo.postIdForRequest(next.id);
      if (existing) {
        await this.setItem(next, { state: "making", post_id: existing, note: null });
        await this.d.repo.markCardsPending(existing);
        return;
      }
    }
    if (Date.parse(next.scheduled_for) - this.d.now() < PLAN_TOO_LATE_MS) {
      await this.hold(next, `There was not enough time to make it before ${manilaLabel(next.scheduled_for)}. Make it on Today if you still want it.`);
      return;
    }
    if (await this.stopped()) return;
    if ((await this.d.repo.themesLeft(next.gender)) < 1) {
      await this.hold(next, `No ${next.gender} photoshoot theme is left. Add ${next.gender} themes on the Themes page, then make this post on Today.`);
      return;
    }
    // A tick killed while picking names (the route's time limit) leaves the item "naming" with the try counted: never
    // start a fourth round, or a post that always runs out of time would loop.
    if (next.attempts >= MAX_NAMING_ATTEMPTS) {
      await this.hold(next, `Couldn't pick names after ${MAX_NAMING_ATTEMPTS} tries. Make this post on Today.`);
      return;
    }
    await this.setItem(next, { state: "naming", attempts: next.attempts + 1 });
    const settings = await this.d.repo.settings();
    const hint = next.name_theme
      ? parseNameThemes(settings.autopilot_name_themes).find((t) => t.title.toLowerCase() === next.name_theme!.toLowerCase())?.hint ?? null
      : null;
    const names = await this.d.pickNames(next, hint, this.start + TICK_BUDGET_MS);
    this.addUsage(names.usage);
    for (const n of names.added) this.event("name_added", `${n} added (${itemLabel(next)}).`);
    for (const s of names.skipped) this.event("name_skipped", `${s.name} skipped: ${s.why}.`);
    for (const text of names.notes ?? []) this.event("run", text);
    if (names.kind === "stop") throw new Pause(`${names.error} Fix it, then press Resume.`);
    if (names.kind === "hold") { await this.hold(next, names.why); return; }
    if (names.kind === "retry") {
      if (next.attempts >= MAX_NAMING_ATTEMPTS) await this.hold(next, `Couldn't pick names: ${names.error}`);
      else await this.setItem(next, { state: "planned", note: `Trying again: ${names.error}` });
      return;
    }
    if (await this.stopped()) return;
    const created = await this.d.createPost({
      gender: next.gender, style: "single", count: null, postDate: next.day, requestId: next.id, subjectAge: "random",
      ...(next.letter ? { letter: next.letter } : {}), nameIds: names.nameIds,
      nameTheme: next.name_theme ? { title: next.name_theme, hint } : null,
    });
    if (!created.ok) {
      if (next.attempts >= MAX_NAMING_ATTEMPTS) await this.hold(next, `Couldn't make the post: ${created.error}`);
      else await this.setItem(next, { state: "planned", note: `Trying again: ${created.error}` });
      return;
    }
    // Save the post id first: a tick that dies from here on is finished by the next one.
    await this.setItem(next, { state: "making", post_id: created.postId, note: null });
    await this.d.repo.markCardsPending(created.postId);
  }
}
