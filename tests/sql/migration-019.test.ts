import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// The live DB = v1 snapshot + 002..018. 019 (the names PDF shop) adds settings.shop_enabled, shop_orders (owner only),
// shop_secrets (nobody reads it) and the narrow functions the public pages call with the anon key.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const ALL = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql",
  "014_reel_formats.sql", "015_name_nest.sql", "016_swap_card_name.sql", "017_initials_posts.sql", "018_names_pdf.sql",
];
const earlier = ALL.map((m) => stripSupabase(read("supabase", "migrations", m)));
const m019raw = read("supabase", "migrations", "019_shop.sql");
const m019 = stripSupabase(m019raw);

const SECRET = "a".repeat(40) + "-shop-key-for-tests-only";
const IP = "0123456789abcdef0123456789abcdef";

async function liveDb(skip015 = false) {
  const db = new PGlite();
  for (const [i, sql] of [v1, ...earlier].entries()) if (!(skip015 && ALL[i - 1] === "015_name_nest.sql")) await db.exec(sql);
  return db;
}
async function migratedDb(o: { secret?: boolean; roles?: boolean } = {}) {
  const db = await liveDb();
  if (o.roles) await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(o.roles ? m019raw : m019);
  // linked and opened (the switch is off until the owner opens the shop at go-live)
  if (o.secret !== false) {
    await db.query(`select set_shop_secret($1)`, [SECRET]);
    await db.exec(`update settings set shop_enabled = true`);
  }
  return db;
}
const fn = async <T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) =>
  (await one<{ r: T }>(db, `select ${sql} r`, params)).r;

/** The given value, null included; the default only when the key is missing. */
const pick = <T extends object>(o: T, k: string, d: unknown) => (k in o ? (o as Record<string, unknown>)[k] : d);
type Created = { status: string; id?: string; token?: string; reason?: string };
const order = (db: PGlite, o: Partial<Record<"pack" | "product" | "currency" | "buyer" | "email" | "fb" | "ip" | "secret", string | null> & { amount: number; ignorePause: boolean }> = {}) =>
  fn<Created>(db, `create_shop_order($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
    pick(o, "pack", "unique-names"), pick(o, "product", "girl"), pick(o, "amount", 5000), pick(o, "currency", "PHP"),
    pick(o, "buyer", "Maria Santos"), pick(o, "email", "maria@example.com"), pick(o, "fb", "Maria S."), pick(o, "ip", IP),
    pick(o, "ignorePause", false), pick(o, "secret", SECRET),
  ]);
const paid = (db: PGlite, id: string, o: Partial<{ checkout: string | null; payment: string; amount: number; currency: string; product: string; password: string; secret: string }> = {}) =>
  fn<Record<string, unknown>>(db, `mark_shop_order_paid($1, $2, $3, $4, $5, $6, $7, $8)`, [
    id, o.checkout === undefined ? "cs_test_1" : o.checkout, o.payment ?? "pay_test_1", o.amount ?? 5000, o.currency ?? "PHP",
    o.product ?? "girl", o.password ?? "Kp7m-Xr4d-Tq9w", o.secret ?? SECRET,
  ]);
const addName = (db: PGlite, name: string, gender: string, style = "single", status = "available") =>
  db.query(`insert into names (name, meaning, gender, style, status) values ($1, 'a kind meaning', $2, $3, $4)`, [name, gender, style, status]);

describe("019_shop.sql on the live schema (v1 + 002..018)", () => {
  it("runs twice, also without 015; the shop switch is OFF by default (the owner opens it at go-live)", async () => {
    const db = await liveDb();
    await db.exec(m019);
    await db.exec(m019);
    expect(await one(db, `select shop_enabled from settings where id = 1`)).toEqual({ shop_enabled: false });
    const db2 = await liveDb(true);
    await db2.exec(m019);
    await db2.query(`select set_shop_secret($1)`, [SECRET]);
    await db2.exec(`update settings set shop_enabled = true`);
    await addName(db2, "Wren", "girl");
    const { token } = await order(db2);
    await paid(db2, (await one<{ id: string }>(db2, `select id from shop_orders`)).id);
    const d = await fn<{ status: string; names: { name: string; origin: string | null }[] }>(db2, `download_shop_order($1)`, [token]);
    expect(d.status).toBe("ok");
    expect(d.names).toEqual([expect.objectContaining({ name: "Wren", origin: null })]);
  });

  it("changes no existing function", async () => {
    const defs = async (db: PGlite) => (await db.query(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname not like '%shop%' order by 1`)).rows;
    const db = await liveDb();
    const want = await defs(db);
    await db.exec(m019);
    expect(await defs(db)).toEqual(want);
  });
});

describe("shop_info", () => {
  it("ready only when the linked key is THIS server's key; closed while the owner's switch is off", async () => {
    const db = await migratedDb({ secret: false });
    expect(await fn(db, `shop_info($1)`, [SECRET])).toMatchObject({ enabled: false, ready: false });
    expect(await order(db)).toEqual({ status: "error", reason: "forbidden" });
    await db.query(`select set_shop_secret($1)`, [SECRET]);
    expect(await fn(db, `shop_info($1)`, [SECRET])).toMatchObject({ enabled: false, ready: true });
    // a stale or foreign key is not "ready"
    expect(await fn(db, `shop_info($1)`, ["b".repeat(64)])).toMatchObject({ ready: false });
    expect(await fn(db, `shop_info($1)`, [null])).toMatchObject({ ready: false });
    expect(await order(db)).toEqual({ status: "error", reason: "closed" });
    // the server's owner-only test mode may order while the switch is off
    expect((await order(db, { ignorePause: true })).status).toBe("ok");
    await db.exec(`update settings set shop_enabled = true`);
    expect(await fn(db, `shop_info($1)`, [SECRET])).toMatchObject({ enabled: true, ready: true });
    expect((await order(db, { email: "b@example.com" })).status).toBe("ok");
  });

  it("counts the approved names of each edition (never pending or skipped)", async () => {
    const db = await migratedDb();
    await addName(db, "Wren", "girl");
    await addName(db, "Ivy Rose", "girl", "two-word", "used");
    await addName(db, "Ash", "boy", "single", "reserved");
    await addName(db, "Zed", "boy", "single", "pending");
    await addName(db, "Kip", "boy", "single", "skip");
    expect((await fn<{ counts: unknown }>(db, `shop_info($1)`, [SECRET])).counts).toEqual({ girl_single: 1, girl_combo: 1, boy_single: 1, boy_combo: 0 });
  });
});

describe("create_shop_order", () => {
  it("makes a pending order with a 96-hex random token; the email is kept in lower case", async () => {
    const db = await migratedDb();
    const a = await order(db, { email: "  Maria@Example.COM " });
    const b = await order(db, { email: "jo@example.com" });
    expect(a).toMatchObject({ status: "ok", id: expect.stringMatching(/^[0-9a-f-]{36}$/), token: expect.stringMatching(/^[0-9a-f]{96}$/) });
    expect(a.token).not.toBe(b.token);
    expect(await one(db, `select status, product, amount, currency, buyer_name, email, fb_name, downloads, password from shop_orders where id = $1`, [a.id]))
      .toEqual({ status: "pending", product: "girl", amount: 5000, currency: "PHP", buyer_name: "Maria Santos", email: "maria@example.com", fb_name: "Maria S.", downloads: 0, password: null });
  });

  it("only our server can create orders: the shop key is required (no bypassing the honeypot / network limit)", async () => {
    const db = await migratedDb();
    for (const secret of [null, "", "x".repeat(40), SECRET.slice(0, -1)]) {
      expect(await order(db, { secret }), String(secret)).toEqual({ status: "error", reason: "forbidden" });
    }
    expect(await one(db, `select count(*)::int n from shop_orders`)).toEqual({ n: 0 });
  });

  it("counts the rate limits under a transaction lock", async () => {
    const db = await migratedDb();
    const src = await one<{ src: string }>(db, `select prosrc src from pg_proc where proname = 'create_shop_order'`);
    expect(src.src).toMatch(/pg_advisory_xact_lock\(hashtext\('public\.create_shop_order'\)\)[\s\S]*rate_limited/);
  });

  it("refuses bad input with 'invalid' (never a crash)", async () => {
    const db = await migratedDb();
    for (const bad of [
      { product: "girls" }, { product: null }, { amount: 0 }, { amount: 99 }, { currency: "php" }, { buyer: "M" }, { buyer: "x".repeat(81) },
      { buyer: "<script>" }, { email: "nope" }, { email: "a@b" }, { email: null }, { fb: "y".repeat(81) }, { ip: "not-a-hash" }, { pack: "" },
    ] as const) {
      expect(await order(db, bad as never), JSON.stringify(bad)).toEqual({ status: "error", reason: "invalid" });
    }
    expect(await one(db, `select count(*)::int n from shop_orders`)).toEqual({ n: 0 });
  });

  it("rate-limits: 5 an hour per email, 10 an hour per network", async () => {
    const db = await migratedDb();
    for (let i = 0; i < 5; i++) expect((await order(db, { ip: null })).status).toBe("ok");
    expect(await order(db, { ip: null })).toEqual({ status: "error", reason: "rate_limited" });
    // an hour later it is fine again
    await db.exec(`update shop_orders set created_at = now() - interval '61 minutes'`);
    expect((await order(db, { ip: null })).status).toBe("ok");
    for (let i = 0; i < 10; i++) expect((await order(db, { email: `b${i}@example.com` })).status).toBe("ok");
    expect(await order(db, { email: "new@example.com" })).toEqual({ status: "error", reason: "rate_limited" });
    expect((await order(db, { email: "new@example.com", ip: "f".repeat(32) })).status).toBe("ok");
  });

  it("caps the whole shop at 120 orders in 10 minutes ('busy')", async () => {
    const db = await migratedDb();
    await db.exec(`insert into shop_orders (token, pack, product, amount, buyer_name, email)
      select repeat(lpad(to_hex(g), 8, '0'), 12), 'unique-names', 'girl', 5000, 'Someone', 'p' || g || '@example.com' from generate_series(1, 120) g`);
    expect(await order(db, { email: "late@example.com", ip: null })).toEqual({ status: "error", reason: "busy" });
  });

  it("expires unpaid orders older than a day", async () => {
    const db = await migratedDb();
    const a = await order(db);
    await db.exec(`update shop_orders set created_at = now() - interval '25 hours'`);
    expect(await fn(db, `get_shop_order_status($1)`, [a.token])).toMatchObject({ status: "expired" });
    await order(db, { email: "other@example.com" });
    expect(await one(db, `select status from shop_orders where id = $1`, [a.id])).toEqual({ status: "expired" });
  });
});

describe("get_shop_order_status", () => {
  it("answers null for a bad or unknown token; the password only once paid", async () => {
    const db = await migratedDb();
    expect(await fn(db, `get_shop_order_status($1)`, ["x"])).toBeNull();
    expect(await fn(db, `get_shop_order_status($1)`, ["0".repeat(96)])).toBeNull();
    expect(await fn(db, `get_shop_order_status($1)`, [null])).toBeNull();
    const a = await order(db);
    expect(await fn(db, `get_shop_order_status($1)`, [a.token])).toMatchObject({ status: "pending", password: null, product: "girl", amount: 5000, expires_at: null });
    await paid(db, a.id!);
    expect(await fn(db, `get_shop_order_status($1)`, [a.token])).toMatchObject({
      status: "paid", password: "Kp7m-Xr4d-Tq9w", downloads: 0, max_downloads: 5, emailed: false, expires_at: expect.any(String),
    });
  });
});

describe("mark_shop_order_paid", () => {
  it("needs the shop key", async () => {
    const db = await migratedDb();
    const a = await order(db);
    for (const s of ["", "wrong".repeat(10), SECRET + "x", SECRET.slice(0, 31)]) {
      expect(await paid(db, a.id!, { secret: s })).toEqual({ status: "error", reason: "forbidden" });
    }
    expect(await one(db, `select status from shop_orders`)).toEqual({ status: "pending" });
  });

  it("checks the amount, the currency and the checkout session", async () => {
    const db = await migratedDb();
    const a = await order(db);
    expect(await fn(db, `attach_shop_checkout($1, $2, $3)`, [a.id, "cs_test_1", SECRET])).toBe(true);
    expect(await paid(db, a.id!, { amount: 100 })).toEqual({ status: "error", reason: "mismatch" });
    expect(await paid(db, a.id!, { amount: 10000 })).toEqual({ status: "error", reason: "mismatch" });
    expect(await paid(db, a.id!, { currency: "USD" })).toEqual({ status: "error", reason: "mismatch" });
    expect(await paid(db, a.id!, { product: "both" })).toEqual({ status: "error", reason: "mismatch" });
    expect(await paid(db, a.id!, { product: "boy" })).toEqual({ status: "error", reason: "mismatch" });
    expect(await paid(db, a.id!, { checkout: "cs_other" })).toEqual({ status: "error", reason: "mismatch" });
    expect(await paid(db, a.id!, { password: "short" })).toEqual({ status: "error", reason: "invalid" });
    expect(await paid(db, "00000000-0000-4000-8000-000000000000")).toEqual({ status: "error", reason: "not_found" });
    expect(await one(db, `select status from shop_orders`)).toEqual({ status: "pending" });
  });

  it("is idempotent: the second call answers already = true and keeps the first password", async () => {
    const db = await migratedDb();
    const a = await order(db);
    const first = await paid(db, a.id!);
    expect(first).toMatchObject({ status: "ok", already: false, token: a.token, email: "maria@example.com", password: "Kp7m-Xr4d-Tq9w", product: "girl" });
    const again = await paid(db, a.id!, { password: "Zz9z-Zz9z-Zz9z" });
    expect(again).toMatchObject({ status: "ok", already: true, password: "Kp7m-Xr4d-Tq9w" });
    expect(await one(db, `select status, payment_id, paid_amount, checkout_id from shop_orders`))
      .toEqual({ status: "paid", payment_id: "pay_test_1", paid_amount: 5000, checkout_id: "cs_test_1" });
  });

  it("one PayMongo payment pays one order only; a late payment of an expired order still counts", async () => {
    const db = await migratedDb();
    const a = await order(db);
    const b = await order(db, { email: "b@example.com" });
    await paid(db, a.id!);
    expect(await paid(db, b.id!)).toEqual({ status: "error", reason: "duplicate_payment" });
    await db.query(`update shop_orders set status = 'expired' where id = $1`, [b.id]);
    expect(await paid(db, b.id!, { payment: "pay_test_2" })).toMatchObject({ status: "ok", already: false });
  });

  it("the table itself refuses a paid order without its payment, time and password", async () => {
    const db = await migratedDb();
    const a = await order(db);
    await expect(db.query(`update shop_orders set status = 'paid' where id = $1`, [a.id])).rejects.toThrow(/shop_orders_paid_check/);
  });
});

describe("note_shop_order_email + attach_shop_checkout", () => {
  it("need the shop key", async () => {
    const db = await migratedDb();
    const a = await order(db);
    expect(await fn(db, `attach_shop_checkout($1, $2, $3)`, [a.id, "cs_1", "nope"])).toBe(false);
    await paid(db, a.id!);
    expect(await fn(db, `note_shop_order_email($1, $2, $3)`, [a.id, null, "nope"])).toBe(false);
    expect(await fn(db, `note_shop_order_email($1, $2, $3)`, [a.id, "SMTP said no", SECRET])).toBe(true);
    expect(await one(db, `select emailed_at, email_error from shop_orders`)).toEqual({ emailed_at: null, email_error: "SMTP said no" });
    expect(await fn(db, `note_shop_order_email($1, $2, $3)`, [a.id, null, SECRET])).toBe(true);
    expect(await one(db, `select emailed_at is not null sent, email_error from shop_orders`)).toEqual({ sent: true, email_error: null });
  });
});

describe("download_shop_order", () => {
  const setup = async (product = "girl") => {
    const db = await migratedDb();
    await addName(db, "Wren", "girl");
    await addName(db, "Ivy Rose", "girl", "two-word", "used");
    await addName(db, "Ash", "boy", "single", "reserved");
    await addName(db, "Zed", "girl", "single", "pending");
    await db.exec(`update names set meaning_category = 'nature' where name = 'Wren'`);
    const a = await order(db, { product, amount: product === "both" ? 10000 : 5000 });
    return { db, a };
  };
  const dl = (db: PGlite, token: string | undefined | null) => fn<Record<string, unknown>>(db, `download_shop_order($1)`, [token]);

  it("refuses an unpaid, unknown or malformed order", async () => {
    const { db, a } = await setup();
    expect(await dl(db, a.token)).toEqual({ status: "error", reason: "unpaid" });
    expect(await dl(db, "f".repeat(96))).toEqual({ status: "error", reason: "not_found" });
    expect(await dl(db, "../../etc")).toEqual({ status: "error", reason: "not_found" });
    expect(await dl(db, null)).toEqual({ status: "error", reason: "not_found" });
    expect(await one(db, `select downloads from shop_orders`)).toEqual({ downloads: 0 });
  });

  it("gives a paid order its edition's approved names and counts each download, at most 5", async () => {
    const { db, a } = await setup();
    await paid(db, a.id!);
    const d = await dl(db, a.token);
    expect(d).toMatchObject({ status: "ok", product: "girl", buyer_name: "Maria Santos", email: "maria@example.com", password: "Kp7m-Xr4d-Tq9w", downloads: 1 });
    expect(d.names).toEqual([
      { name: "Ivy Rose", meaning: "a kind meaning", gender: "girl", style: "two-word", status: "used", origin: null, meaning_category: null },
      { name: "Wren", meaning: "a kind meaning", gender: "girl", style: "single", status: "available", origin: null, meaning_category: "nature" },
    ]);
    for (let i = 2; i <= 5; i++) expect(await dl(db, a.token)).toMatchObject({ status: "ok", downloads: i });
    expect(await dl(db, a.token)).toEqual({ status: "error", reason: "limit" });
    expect(await one(db, `select downloads from shop_orders`)).toEqual({ downloads: 5 });
  });

  it("'both' gets girl and boy names; the link ends 7 days after payment", async () => {
    const { db, a } = await setup("both");
    await paid(db, a.id!, { amount: 10000, product: "both" });
    expect(((await dl(db, a.token)).names as { name: string }[]).map((n) => n.name)).toEqual(["Ash", "Ivy Rose", "Wren"]);
    await db.exec(`update shop_orders set paid_at = now() - interval '7 days 1 minute'`);
    expect(await dl(db, a.token)).toEqual({ status: "error", reason: "expired" });
  });
});

describe("claim_shop_check (the thanks page's PayMongo check)", () => {
  it("once per 10 s and at most 60 times per pending order; needs the shop key", async () => {
    const db = await migratedDb();
    const a = await order(db);
    const claim = (secret = SECRET) => fn<boolean>(db, `claim_shop_check($1, $2)`, [a.token, secret]);
    expect(await claim("nope".repeat(10))).toBe(false);
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false); // within 10 s
    await db.exec(`update shop_orders set last_checked_at = now() - interval '11 seconds'`);
    expect(await claim()).toBe(true);
    await db.exec(`update shop_orders set last_checked_at = now() - interval '11 seconds', checks = 60`);
    expect(await claim()).toBe(false); // cap reached
    await db.exec(`update shop_orders set checks = 0, last_checked_at = null`);
    await paid(db, a.id!);
    expect(await claim()).toBe(false); // nothing to check once paid
    expect(await fn(db, `claim_shop_check($1, $2)`, ["x", SECRET])).toBe(false);
  });
});

describe("release_shop_download (a PDF that could not be made gives its download back)", () => {
  it("needs the shop key, never goes below zero", async () => {
    const db = await migratedDb();
    await addName(db, "Wren", "girl");
    const a = await order(db);
    await paid(db, a.id!);
    await fn(db, `download_shop_order($1)`, [a.token]);
    expect(await one(db, `select downloads from shop_orders`)).toEqual({ downloads: 1 });
    expect(await fn(db, `release_shop_download($1, $2)`, [a.token, "nope".repeat(10)])).toBe(false);
    expect(await fn(db, `release_shop_download($1, $2)`, [a.token, SECRET])).toBe(true);
    expect(await one(db, `select downloads from shop_orders`)).toEqual({ downloads: 0 });
    expect(await fn(db, `release_shop_download($1, $2)`, [a.token, SECRET])).toBe(false);
    expect(await one(db, `select downloads from shop_orders`)).toEqual({ downloads: 0 });
  });
});

describe("set_shop_secret / shop_secret_matches", () => {
  it("stores only a hash and refuses short keys", async () => {
    const db = await migratedDb({ secret: false });
    expect(await fn(db, `set_shop_secret($1)`, ["short"])).toBe(false);
    expect(await fn(db, `set_shop_secret($1)`, [SECRET])).toBe(true);
    expect(await fn(db, `shop_secret_matches($1)`, [SECRET])).toBe(true);
    expect(await fn(db, `shop_secret_matches($1)`, [SECRET + "!"])).toBe(false);
    const row = await one<{ n: number; plain: boolean }>(db, `select octet_length(key_hash) n, position(convert_to($1, 'UTF8') in key_hash) > 0 plain from shop_secrets`, [SECRET]);
    expect(row).toEqual({ n: 32, plain: false });
    expect(await fn(db, `set_shop_secret($1)`, ["b".repeat(64)])).toBe(true);
    expect(await fn(db, `shop_secret_matches($1)`, [SECRET])).toBe(false);
    expect(await one(db, `select count(*)::int n from shop_secrets`)).toEqual({ n: 1 });
  });
});

describe("permissions (Supabase roles)", () => {
  it("anon can only call the shop's public functions: no table, no key, no owner function", async () => {
    const db = await migratedDb({ roles: true });
    await db.exec(m019raw); // twice: idempotent with the grants too
    await addName(db, "Wren", "girl");
    const can = async (role: string, obj: string, priv: string) =>
      (await one<{ ok: boolean }>(db, `select has_table_privilege($1, $2, $3) ok`, [role, obj, priv])).ok;
    for (const priv of ["select", "insert", "update", "delete"]) {
      expect(await can("anon", "public.shop_orders", priv)).toBe(false);
      expect(await can("anon", "public.shop_secrets", priv)).toBe(false);
      expect(await can("authenticated", "public.shop_secrets", priv)).toBe(false);
      expect(await can("authenticated", "public.shop_orders", priv)).toBe(true);
    }
    const exec = async (role: string, f: string) =>
      (await one<{ ok: boolean }>(db, `select has_function_privilege($1, $2, 'execute') ok`, [role, f])).ok;
    for (const f of ["shop_info(text)", "create_shop_order(text, text, int, text, text, text, text, text, boolean, text)", "get_shop_order_status(text)",
      "attach_shop_checkout(uuid, text, text)", "claim_shop_check(text, text)", "mark_shop_order_paid(uuid, text, text, int, text, text, text, text)",
      "note_shop_order_email(uuid, text, text)", "download_shop_order(text)", "release_shop_download(text, text)"]) {
      expect(await exec("anon", `public.${f}`), f).toBe(true);
    }
    for (const f of ["shop_secret_ok(text)", "set_shop_secret(text)", "shop_secret_matches(text)"]) expect(await exec("anon", `public.${f}`), f).toBe(false);
    expect(await exec("authenticated", "public.shop_secret_ok(text)")).toBe(false);
    expect(await exec("authenticated", "public.set_shop_secret(text)")).toBe(true);

    // As anon for real: the functions work, the tables do not.
    await db.exec("grant usage on schema public to anon, authenticated");
    await db.exec("set role anon");
    const a = await order(db);
    expect(a.status).toBe("ok");
    expect(await fn(db, `get_shop_order_status($1)`, [a.token])).toMatchObject({ status: "pending" });
    await expect(db.query(`select * from shop_orders`)).rejects.toThrow(/permission denied/);
    await expect(db.query(`select * from shop_secrets`)).rejects.toThrow(/permission denied/);
    await expect(db.query(`select set_shop_secret($1)`, ["c".repeat(64)])).rejects.toThrow(/permission denied/);
    await expect(db.query(`update shop_orders set status = 'paid'`)).rejects.toThrow(/permission denied/);
    expect(await paid(db, a.id!, { secret: "x".repeat(40) })).toEqual({ status: "error", reason: "forbidden" });
    expect(await paid(db, a.id!)).toMatchObject({ status: "ok", already: false });
    await db.exec("reset role");
  });

  it("RLS: shop_orders owner only, shop_secrets with no policy at all", async () => {
    const db = await migratedDb({ roles: true });
    expect((await db.query(`select relname, relrowsecurity from pg_class where oid in ('public.shop_orders'::regclass, 'public.shop_secrets'::regclass) order by 1`)).rows)
      .toEqual([{ relname: "shop_orders", relrowsecurity: true }, { relname: "shop_secrets", relrowsecurity: true }]);
    expect((await db.query(`select tablename, policyname, roles::text, cmd from pg_policies where tablename like 'shop_%'`)).rows)
      .toEqual([{ tablename: "shop_orders", policyname: "owner_all", roles: "{authenticated}", cmd: "ALL" }]);
  });

  it("every shop function is SECURITY DEFINER with a fixed search_path", async () => {
    const db = await migratedDb();
    const rows = (await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      `select proname, prosecdef, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname like '%shop%' order by 1`)).rows;
    expect(rows.map((r) => r.proname)).toEqual([
      "attach_shop_checkout", "claim_shop_check", "create_shop_order", "download_shop_order", "get_shop_order_status", "mark_shop_order_paid",
      "note_shop_order_email", "release_shop_download", "set_shop_secret", "shop_info", "shop_secret_matches", "shop_secret_ok",
    ]);
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect(r.proconfig, r.proname).toEqual(["search_path=public, pg_temp"]);
    }
  });
});

describe("fresh schema.sql matches v1 + 002..019 (settings, shop_orders, shop_secrets, shop functions)", () => {
  const TABLES = "('settings','shop_orders','shop_secrets')";
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
    constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
    indexes: (await db.query(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ${TABLES} order by 1, 2`)).rows,
    triggers: (await db.query(`select tgname, tgrelid::regclass::text t from pg_trigger where not tgisinternal and tgrelid::regclass::text in ${TABLES} order by 2, 1`)).rows,
    functions: (await db.query(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname like '%shop%' order by 1`)).rows,
  });

  it("has the same columns, constraints, indexes, triggers and functions", async () => {
    const want = await shape(await migratedDb({ secret: false }));
    expect((want.columns as { column_name: string }[]).map((c) => c.column_name)).toEqual(expect.arrayContaining(["shop_enabled", "token", "key_hash"]));
    expect(await shape(await freshDb())).toEqual(want);
  });

  it("is also safe to run on a fresh schema.sql project", async () => {
    const db = await freshDb();
    await db.exec(m019);
    await db.query(`select set_shop_secret($1)`, [SECRET]);
    await db.exec(`update settings set shop_enabled = true`);
    expect((await order(db)).status).toBe("ok");
  });

  it("schema.sql turns on RLS, the owner policy and the anon grants", () => {
    const schema = read("supabase", "schema.sql");
    expect(schema).toMatch(/alter table public\.shop_orders enable row level security;/);
    expect(schema).toMatch(/alter table public\.shop_secrets enable row level security;/);
    expect(schema).toMatch(/foreach t in array array\[[^\]]*'shop_orders'[^\]]*\] loop\s+execute format\('drop policy if exists owner_all/);
    expect(schema).toMatch(/revoke all on public\.shop_secrets from anon, authenticated;/);
    expect(schema).toMatch(/grant execute on function public\.shop_info\(text\)[\s\S]*to anon, authenticated, service_role;/);
  });
});
