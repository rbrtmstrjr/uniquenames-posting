import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

let db: PGlite;
let themeId: string;
let nameIds: string[];

async function addTheme(title: string, gender = "boy") {
  const r = await one<{ id: string }>(db,
    `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ($1,$2,'b','o','p','l','c') returning id`, [title, gender]);
  return r.id;
}
async function addNames(count: number, gender = "boy", style = "two-word") {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = await one<{ id: string }>(db, `insert into names (name, meaning, gender, style) values ($1,'m',$2,$3) returning id`,
      [`Name${gender}${style}${i} X`, gender, style]);
    ids.push(r.id);
  }
  return ids;
}
const plan = (ids: string[], extra: Record<string, unknown> = {}) => ({
  request_id: crypto.randomUUID(), post_date: "2026-10-05", gender: "boy", style: "two-word", theme_id: themeId, caption: "cap",
  cards: ids.map((id, i) => ({ position: i + 1, name_id: id, name: `N${i}`, meaning: "m", shot: "s", prompt: "p", seed: 100 + i })),
  ...extra,
});
const createPost = async (p: unknown) => (await one<{ r: { status: string; post_id?: string; reason?: string } }>(db, `select create_post($1::jsonb) as r`, [JSON.stringify(p)])).r;
const claim = async () => (await one<{ r: { job: string; card: { id: string; status: string }; gender_label: string } | null }>(db, `select claim_next_card() as r`)).r;

beforeEach(async () => {
  db = await freshDb();
  themeId = await addTheme("Boho");
  nameIds = await addNames(10);
});

describe("create_post", () => {
  it("reserves names, uses the theme, queues cards", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    expect(r.status).toBe("ok");
    const c = await one<{ n: number }>(db, `select count(*)::int n from cards where post_id=$1 and status='queued'`, [r.post_id]);
    expect(c.n).toBe(9);
    const names = await one<{ n: number }>(db, `select count(*)::int n from names where status='reserved' and post_id=$1`, [r.post_id]);
    expect(names.n).toBe(9);
    const t = await one<{ status: string; used_on: string }>(db, `select status, used_on::text from themes where id=$1`, [themeId]);
    expect(t).toEqual({ status: "used", used_on: "2026-10-05" });
  });
  it("is idempotent per request_id", async () => {
    const p = plan(nameIds.slice(0, 9));
    const a = await createPost(p);
    const b = await createPost(p);
    expect(b.post_id).toBe(a.post_id);
    expect((await one<{ n: number }>(db, `select count(*)::int n from posts`)).n).toBe(1);
  });
  it("conflicts when a name was taken meanwhile", async () => {
    await db.query(`update names set status='used' where id=$1`, [nameIds[0]]);
    expect(await createPost(plan(nameIds.slice(0, 9)))).toEqual({ status: "conflict", reason: "names" });
    expect((await one<{ n: number }>(db, `select count(*)::int n from posts`)).n).toBe(0);
  });
  it("conflicts when the theme is used or wrong gender", async () => {
    await createPost(plan(nameIds.slice(0, 9)));
    expect((await createPost(plan([nameIds[9]]))).reason).toBe("theme");
    const girlTheme = await addTheme("Blush", "girl");
    expect((await createPost(plan([nameIds[9]], { theme_id: girlTheme }))).reason).toBe("theme");
  });
});

describe("post status follows cards", () => {
  it("becomes ready and names used when every card is done; back to generating on regenerate", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    await db.query(`update cards set status='done', card_path='x' where post_id=$1`, [r.post_id]);
    expect((await one<{ status: string }>(db, `select status from posts where id=$1`, [r.post_id])).status).toBe("ready");
    expect((await one<{ n: number }>(db, `select count(*)::int n from names where status='used'`)).n).toBe(9);
    await db.query(`update cards set status='queued' where post_id=$1 and position=1`, [r.post_id]);
    expect((await one<{ status: string }>(db, `select status from posts where id=$1`, [r.post_id])).status).toBe("generating");
  });
  it("posted stays posted", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    await db.query(`update posts set status='posted' where id=$1`, [r.post_id]);
    await db.query(`update cards set status='done' where post_id=$1`, [r.post_id]);
    expect((await one<{ status: string }>(db, `select status from posts where id=$1`, [r.post_id])).status).toBe("posted");
  });
});

describe("worker queue", () => {
  it("claims restamp first, then oldest queued; never the same card twice", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    await db.query(`update cards set status='done' where post_id=$1 and position=5`, [r.post_id]);
    await db.query(`update cards set status='restamp', queued_at=now() + interval '1 hour' where post_id=$1 and position=5`, [r.post_id]);
    const first = await claim();
    expect(first?.job).toBe("restamp");
    expect(first?.gender_label).toBe("Boy");
    const second = await claim();
    expect(second?.job).toBe("generate");
    expect(second?.card.status).toBe("generating");
    expect(second?.card.id).not.toBe(first?.card.id);
    const ids = new Set<string>([first!.card.id, second!.card.id]);
    for (let i = 0; i < 7; i++) ids.add((await claim())!.card.id);
    expect(ids.size).toBe(9);
    expect(await claim()).toBeNull();
  });
  it("requeues stuck cards and fails them after 3 attempts", async () => {
    await createPost(plan(nameIds.slice(0, 9)));
    const c = await claim();
    await db.query(`update cards set claimed_at = now() - interval '6 minutes' where id=$1`, [c!.card.id]);
    expect((await one<{ n: number }>(db, `select requeue_stuck_cards() n`)).n).toBe(1);
    expect((await one<{ status: string }>(db, `select status from cards where id=$1`, [c!.card.id])).status).toBe("queued");
    await db.query(`update cards set status='generating', attempts=3, claimed_at = now() - interval '6 minutes' where id=$1`, [c!.card.id]);
    await db.query(`select requeue_stuck_cards()`);
    const f = await one<{ status: string; error: string }>(db, `select status, error from cards where id=$1`, [c!.card.id]);
    expect(f.status).toBe("failed");
    expect(f.error).toMatch(/3 tries/);
  });
});

describe("add / delete", () => {
  it("add_card appends at the next position and reserves the name", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    const a = (await one<{ r: { status: string } }>(db, `select add_card($1, $2::jsonb) r`,
      [r.post_id, JSON.stringify({ name_id: nameIds[9], name: "N9", meaning: "m", shot: "s", prompt: "p", seed: 1 })])).r;
    expect(a.status).toBe("ok");
    expect((await one<{ m: number }>(db, `select max(position)::int m from cards where post_id=$1`, [r.post_id])).m).toBe(10);
    expect((await one<{ status: string }>(db, `select status from names where id=$1`, [nameIds[9]])).status).toBe("reserved");
  });
  it("delete_card frees the name and returns paths", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    const card = await one<{ id: string; name_id: string }>(db, `select id, name_id from cards where post_id=$1 and position=1`, [r.post_id]);
    await db.query(`update cards set photo_path='photos/a/v1.jpg', card_path='cards/a/v1.jpg' where id=$1`, [card.id]);
    const d = (await one<{ r: { paths: string[] } }>(db, `select delete_card($1) r`, [card.id])).r;
    expect(d.paths.sort()).toEqual(["cards/a/v1.jpg", "photos/a/v1.jpg"]);
    expect((await one<{ status: string }>(db, `select status from names where id=$1`, [card.name_id])).status).toBe("available");
  });
  it("delete_post frees names and the theme", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    const d = (await one<{ r: { status: string } }>(db, `select delete_post($1) r`, [r.post_id])).r;
    expect(d.status).toBe("ok");
    expect((await one<{ n: number }>(db, `select count(*)::int n from names where status='available'`)).n).toBe(10);
    expect((await one<{ status: string }>(db, `select status from themes where id=$1`, [themeId])).status).toBe("available");
    expect((await one<{ n: number }>(db, `select count(*)::int n from cards`)).n).toBe(0);
  });
  it("a finished preview card becomes the theme preview", async () => {
    const c = await one<{ id: string }>(db,
      `insert into cards (theme_id, kind, name, meaning, shot, prompt, seed) values ($1,'preview','Sample Name','m','s','p',1) returning id`, [themeId]);
    await db.query(`update cards set status='done' where id=$1`, [c.id]);
    expect((await one<{ preview_card_id: string }>(db, `select preview_card_id from themes where id=$1`, [themeId])).preview_card_id).toBe(c.id);
  });
});
