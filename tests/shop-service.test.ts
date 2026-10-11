import { describe, expect, it } from "vitest";
import { packById } from "@/packs";
import { shopEnv, shopKey } from "@/lib/shop/config";
import { signPayload } from "@/lib/shop/paymongo";
import {
  deliverOrder, downloadOrder, fulfilSession, handleWebhook, orderStatus, shopState, startCheckout, type ShopDb,
} from "@/lib/shop/service";
import { shopDb } from "./helpers/shop-db";
import { one } from "./helpers/pglite";

// The shop end to end on the real migration 019 functions (PGlite) with a fake PayMongo.
const UN = packById("unique-names");
const WEBHOOK = "whsk_test_unit_secret";
const ENV = shopEnv(UN.shop, { PAYMONGO_SECRET_KEY: "sk_test_unit", PAYMONGO_WEBHOOK_SECRET: WEBHOOK, SHOP_BASE_URL: "https://shop.example.com" });
const KEY = shopKey(WEBHOOK);
const NAMES: [string, "girl" | "boy", "single" | "two-word"][] = [["Wren", "girl", "single"], ["Ivy Rose", "girl", "two-word"], ["Ash", "boy", "single"]];
const FORM = { product: "girl", buyerName: "Maria Santos", email: "Maria@Example.com", fbName: "" };
const NOW = new Date();

type Call = { url: string; method: string; body: unknown; auth: string | null };
function fakePaymongo(o: { create?: (n: number) => Response; get?: (id: string) => Response } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.get("authorization") });
    if (url.endsWith("/v2/checkout_sessions")) {
      n += 1;
      return o.create?.(n) ?? Response.json({ data: { id: `cs_test_${n}`, type: "checkout_session", attributes: { checkout_url: `https://checkout.paymongo.com/cs_test_${n}`, livemode: false } } });
    }
    const id = url.split("/").pop()!;
    return o.get?.(id) ?? Response.json({ errors: [{ code: "not_found" }] }, { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

async function setup(o: { linked?: boolean } = {}) {
  const { db, rpc } = await shopDb({ key: o.linked === false ? undefined : KEY, names: NAMES });
  return { db, rpc };
}
async function checkout(rpc: ShopDb, body: unknown = FORM, f = fakePaymongo()) {
  const r = await startCheckout({
    db: rpc, pack: UN, env: ENV, body, headers: new Headers({ "x-forwarded-for": "203.0.113.9" }), requestUrl: "https://evil.example/api/shop/checkout", fetch: f.f,
  });
  return { r, calls: f.calls };
}
const orderRow = (db: Awaited<ReturnType<typeof setup>>["db"]) =>
  one<{ id: string; token: string; status: string; amount: number; checkout_id: string | null; password: string | null; ip_hash: string | null; email: string }>(
    db, `select id, token, status, amount, checkout_id, password, ip_hash, email from shop_orders order by created_at desc limit 1`);

const paidSession = (id: string, o: Partial<{ checkout: string; amount: number; currency: string; product: string; payment: string; livemode: boolean; orderId: string }> = {}) => ({
  id: o.checkout ?? "cs_test_1", type: "checkout_session",
  attributes: {
    reference_number: id, livemode: o.livemode ?? false, metadata: { order_id: o.orderId ?? id, product: o.product ?? "girl", pack: "unique-names" },
    payments: [{ id: o.payment ?? "pay_test_1", attributes: { amount: o.amount ?? 5000, currency: o.currency ?? "PHP", status: "paid" } }],
  },
});
const event = (session: unknown, o: { type?: string; livemode?: boolean } = {}) =>
  JSON.stringify({ data: { id: "evt_1", type: "event", attributes: { type: o.type ?? "checkout_session.payment.paid", livemode: o.livemode ?? false, data: session } } });
const signed = (raw: string, o: { secret?: string; at?: Date; live?: boolean } = {}) => {
  const t = Math.floor((o.at ?? NOW).getTime() / 1000);
  const s = signPayload(o.secret ?? WEBHOOK, t, raw);
  return o.live ? `t=${t},te=,li=${s}` : `t=${t},te=${s},li=`;
};
const webhook = (rpc: ShopDb, raw: string, signature: string | null, env = ENV) => handleWebhook({ db: rpc, pack: UN, env, rawBody: raw, signature, now: NOW });

describe("shopState", () => {
  it("open only with the pack on, the keys set, 019 run, the key linked and the switch on", async () => {
    const { db, rpc } = await setup({ linked: false });
    expect(await shopState(rpc, UN, ENV)).toMatchObject({ open: false, reason: "unlinked", counts: { girl_single: 1, girl_combo: 1, boy_single: 1, boy_combo: 0 } });
    await db.query(`select set_shop_secret($1)`, [KEY]);
    expect(await shopState(rpc, UN, ENV)).toMatchObject({ open: true });
    expect(await shopState(rpc, UN, shopEnv(UN.shop, {}))).toMatchObject({ open: false, reason: "keys" });
    expect(await shopState(rpc, packById("name-nest"), ENV)).toMatchObject({ open: false, reason: "pack" });
    await db.exec(`update settings set shop_enabled = false`);
    expect(await shopState(rpc, UN, ENV)).toMatchObject({ open: false, reason: "paused" });
  });

  it("before migration 019: 'migration' (the page shows Coming soon)", async () => {
    const missing: ShopDb = { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.shop_info" } }) };
    expect(await shopState(missing, UN, ENV)).toEqual({ open: false, reason: "migration", counts: null });
  });
});

describe("startCheckout", () => {
  it("creates a pending order and a QR Ph checkout at the SERVER's price, then keeps the session id", async () => {
    const { db, rpc } = await setup();
    const { r, calls } = await checkout(rpc, { ...FORM, product: "both", amount: 1, price: 1, currency: "USD" });
    expect(r).toEqual({ ok: true, url: "https://checkout.paymongo.com/cs_test_1" });
    const o = await orderRow(db);
    expect(o).toMatchObject({ status: "pending", amount: 10000, checkout_id: "cs_test_1", password: null, email: "maria@example.com" });
    expect(o.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(calls).toHaveLength(1);
    const a = (calls[0].body as { data: { attributes: Record<string, unknown> } }).data.attributes;
    expect(calls[0].auth).toBe(`Basic ${Buffer.from("sk_test_unit:").toString("base64")}`);
    expect(a.line_items).toEqual([{ name: "Girl & Boy Bundle", amount: 10000, currency: "PHP", quantity: 1, description: "The Unique Names Collection" }]);
    expect(a.payment_method_types).toEqual(["qrph"]);
    expect(a.reference_number).toBe(o.id);
    expect(a.metadata).toEqual({ order_id: o.id, product: "both", pack: "unique-names" });
    // links use the configured site address, never the request's Host
    expect(a.success_url).toBe(`https://shop.example.com/shop/thanks?o=${o.token}`);
    expect(a.cancel_url).toBe("https://shop.example.com/shop?cancelled=1");
    expect(a.billing).toEqual({ name: "Maria Santos", email: "maria@example.com" });
  });

  it("offers more methods when env says so", async () => {
    const { rpc } = await setup();
    const env = shopEnv(UN.shop, { PAYMONGO_SECRET_KEY: "sk_test_unit", PAYMONGO_WEBHOOK_SECRET: WEBHOOK, SHOP_PAYMENT_METHODS: "qrph,gcash,paymaya" });
    const f = fakePaymongo();
    await startCheckout({ db: rpc, pack: UN, env, body: FORM, headers: new Headers(), requestUrl: "https://x.example/api", fetch: f.f });
    expect((f.calls[0].body as { data: { attributes: { payment_method_types: string[] } } }).data.attributes.payment_method_types).toEqual(["qrph", "gcash", "paymaya"]);
  });

  it("refuses bad forms and bots before touching the database", async () => {
    const { rpc } = await setup();
    expect((await checkout(rpc, { ...FORM, email: "nope" })).r).toMatchObject({ ok: false, status: 400, field: "email" });
    expect((await checkout(rpc, { ...FORM, website: "x" })).r).toMatchObject({ ok: false, status: 400, field: "spam" });
    expect(rpc.calls).toEqual([]);
  });

  it("closed without keys or before the key is linked", async () => {
    const { rpc } = await setup({ linked: false });
    expect((await checkout(rpc)).r).toMatchObject({ ok: false, status: 409 });
    const r2 = await startCheckout({ db: rpc, pack: UN, env: shopEnv(UN.shop, {}), body: FORM, headers: new Headers(), requestUrl: "https://x.example/" });
    expect(r2).toMatchObject({ ok: false, status: 409 });
  });

  it("rate limit -> 429; PayMongo down -> 502 with a friendly message", async () => {
    const { rpc } = await setup();
    for (let i = 0; i < 5; i++) expect((await checkout(rpc)).r.ok).toBe(true);
    expect((await checkout(rpc)).r).toMatchObject({ ok: false, status: 429 });
    const down = fakePaymongo({ create: () => Response.json({ errors: [{ code: "parameter_invalid", detail: "secret stuff" }] }, { status: 400 }) });
    const r = (await checkout(rpc, { ...FORM, email: "jo@example.com" }, down)).r;
    expect(r).toEqual({ ok: false, status: 502, error: "Payment is not available right now. Please try again in a minute." });
  });
});

describe("webhook", () => {
  it("a signed checkout_session.payment.paid marks the order paid once, with a fresh password, and asks for one email", async () => {
    const { db, rpc } = await setup();
    await checkout(rpc);
    const o = await orderRow(db);
    const raw = event(paidSession(o.id));
    const first = await webhook(rpc, raw, signed(raw));
    expect(first).toMatchObject({ status: 200, body: { ok: true, already: false }, deliver: { id: o.id, token: o.token, email: "maria@example.com", product: "girl" } });
    const after = await orderRow(db);
    expect(after.status).toBe("paid");
    expect(after.password).toMatch(/^[A-HJ-NP-Za-hj-km-np-z2-9]{4}-[A-HJ-NP-Za-hj-km-np-z2-9]{4}-[A-HJ-NP-Za-hj-km-np-z2-9]{4}$/);
    // PayMongo retries / a replay inside the window: still 200, same password, no second email
    const again = await webhook(rpc, raw, signed(raw));
    expect(again).toMatchObject({ status: 200, body: { ok: true, already: true }, deliver: null });
    expect((await orderRow(db)).password).toBe(after.password);
  });

  it("rejects a bad, missing, replayed or live-mode signature (401) and changes nothing", async () => {
    const { db, rpc } = await setup();
    await checkout(rpc);
    const o = await orderRow(db);
    const raw = event(paidSession(o.id));
    expect((await webhook(rpc, raw, null)).status).toBe(401);
    expect((await webhook(rpc, raw, signed(raw, { secret: "whsk_wrong" }))).status).toBe(401);
    expect((await webhook(rpc, raw.replace("5000", "5001"), signed(raw))).status).toBe(401);
    expect((await webhook(rpc, raw, signed(raw, { at: new Date(NOW.getTime() - 10 * 60_000) }))).status).toBe(401);
    expect((await webhook(rpc, raw, signed(raw, { live: true }))).status).toBe(401);
    expect((await orderRow(db)).status).toBe("pending");
  });

  it("an amount, currency or product that does not match is acknowledged (no retries) but never pays", async () => {
    const { db, rpc } = await setup();
    await checkout(rpc);
    const o = await orderRow(db);
    for (const bad of [{ amount: 100 }, { amount: 10000 }, { currency: "USD" }, { amount: 10000, product: "both" }, { checkout: "cs_someone_else" }, { orderId: "22222222-2222-4222-8222-222222222222" }]) {
      const raw = event(paidSession(o.id, bad));
      const r = await webhook(rpc, raw, signed(raw));
      expect(r.status, JSON.stringify(bad)).toBe(200);
      expect(r.deliver).toBeNull();
    }
    expect((await orderRow(db)).status).toBe("pending");
  });

  it("ignores other events, the other mode and unknown orders with 200", async () => {
    const { db, rpc } = await setup();
    await checkout(rpc);
    const o = await orderRow(db);
    for (const raw of [
      event(paidSession(o.id), { type: "payment.paid" }), event(paidSession(o.id), { livemode: true }),
      event(paidSession("33333333-3333-4333-8333-333333333333")), event({ id: "pay_1" }), "not json",
    ]) {
      const r = await webhook(rpc, raw, signed(raw));
      expect(r.status, raw.slice(0, 60)).toBe(200);
      expect(r.deliver).toBeNull();
    }
    expect((await orderRow(db)).status).toBe("pending");
  });

  it("503 when the webhook secret is not set; 500 (PayMongo retries) when the database fails", async () => {
    const { db, rpc } = await setup();
    await checkout(rpc);
    const o = await orderRow(db);
    const raw = event(paidSession(o.id));
    expect((await webhook(rpc, raw, signed(raw), shopEnv(UN.shop, { PAYMONGO_SECRET_KEY: "sk_test_x" }))).status).toBe(503);
    const broken: ShopDb = { rpc: async () => ({ data: null, error: { message: "connection reset", code: "08006" } }) };
    expect((await webhook(broken, raw, signed(raw))).status).toBe(500);
  });

  it("an order paid after it expired still counts (the money arrived)", async () => {
    const { db, rpc } = await setup();
    await checkout(rpc);
    const o = await orderRow(db);
    await db.exec(`update shop_orders set status = 'expired'`);
    const raw = event(paidSession(o.id));
    expect((await webhook(rpc, raw, signed(raw))).body).toMatchObject({ ok: true, already: false });
  });
});

describe("thanks page status + PayMongo check", () => {
  it("pending -> asks PayMongo (not the redirect) -> paid, with the password and a masked email", async () => {
    const { db, rpc } = await setup();
    await checkout(rpc);
    const o = await orderRow(db);
    const later = new Date(Date.now() + 30_000);
    expect(await orderStatus({ db: rpc, pack: UN, env: ENV, token: o.token, check: false, now: later }))
      .toMatchObject({ found: true, view: { status: "pending", password: null, email: "ma•••@example.com", productName: "Girl Names Edition" }, deliver: null });
    // PayMongo still unpaid
    const unpaid = fakePaymongo({ get: () => Response.json({ data: { ...paidSession(o.id), attributes: { ...paidSession(o.id).attributes, payments: [] } } }) });
    expect(await orderStatus({ db: rpc, pack: UN, env: ENV, token: o.token, check: true, now: later, fetch: unpaid.f })).toMatchObject({ view: { status: "pending" } });
    expect(unpaid.calls[0].url).toBe("https://api.paymongo.com/v1/checkout_sessions/cs_test_1");
    // now paid
    const paidPm = fakePaymongo({ get: () => Response.json({ data: paidSession(o.id) }) });
    const r = await orderStatus({ db: rpc, pack: UN, env: ENV, token: o.token, check: true, now: later, fetch: paidPm.f });
    expect(r).toMatchObject({ found: true, view: { status: "paid", downloads: 0, maxDownloads: 5, emailed: false }, deliver: { id: o.id } });
    if (!r.found) throw new Error("not found");
    expect(r.view.password).toMatch(/-/);
    // the next poll does not ask PayMongo again, nor email again
    const quiet = fakePaymongo();
    expect(await orderStatus({ db: rpc, pack: UN, env: ENV, token: o.token, check: true, now: later, fetch: quiet.f })).toMatchObject({ deliver: null });
    expect(quiet.calls).toEqual([]);
  });

  it("a paid session for ANOTHER order never pays this one", async () => {
    const { db, rpc } = await setup();
    await checkout(rpc);
    const o = await orderRow(db);
    const other = fakePaymongo({ get: () => Response.json({ data: paidSession("44444444-4444-4444-8444-444444444444") }) });
    const r = await orderStatus({ db: rpc, pack: UN, env: ENV, token: o.token, check: true, now: new Date(Date.now() + 30_000), fetch: other.f });
    expect(r).toMatchObject({ view: { status: "pending" }, deliver: null });
  });

  it("unknown or malformed tokens are not found", async () => {
    const { rpc } = await setup();
    expect(await orderStatus({ db: rpc, pack: UN, env: ENV, token: "abc", check: false, now: NOW })).toEqual({ found: false });
    expect(await orderStatus({ db: rpc, pack: UN, env: ENV, token: "a".repeat(96), check: false, now: NOW })).toEqual({ found: false });
  });
});

describe("delivery + download", () => {
  async function paidOrder(product = "girl") {
    const { db, rpc } = await setup();
    await checkout(rpc, { ...FORM, product });
    const o = await orderRow(db);
    const r = await fulfilSession({ db: rpc, pack: UN, env: ENV, session: { id: "cs_test_1", reference: o.id, metadata: { order_id: o.id, product }, livemode: false, paid: { id: "pay_1", amount: o.amount, currency: "PHP" } } });
    if (r.kind !== "paid") throw new Error(r.why);
    return { db, rpc, o: await orderRow(db), order: r.order };
  }

  it("emails the link + password once and notes it; without SMTP notes why", async () => {
    const { db, rpc, order } = await paidOrder();
    const sent: { to: string; text: string }[] = [];
    const env = shopEnv(UN.shop, { PAYMONGO_SECRET_KEY: "sk_test_unit", PAYMONGO_WEBHOOK_SECRET: WEBHOOK, SMTP_USER: "me@gmail.com", SMTP_PASS: "x" });
    expect(await deliverOrder({ db: rpc, pack: UN, env, order, baseUrl: "https://shop.example.com", mailer: async (m) => { sent.push(m); } })).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("maria@example.com");
    expect(sent[0].text).toContain(`https://shop.example.com/shop/thanks?o=${order.token}`);
    expect(sent[0].text).toContain(order.password);
    expect(await one(db, `select emailed_at is not null sent, email_error from shop_orders`)).toEqual({ sent: true, email_error: null });
    expect(await deliverOrder({ db: rpc, pack: UN, env: ENV, order, baseUrl: "https://shop.example.com" })).toMatch(/not set up/);
    expect(await one(db, `select email_error from shop_orders`)).toEqual({ email_error: "Email is not set up (SMTP_USER / SMTP_PASS)." });
  });

  it("unpaid orders get no PDF", async () => {
    const { db, rpc } = await setup();
    await checkout(rpc);
    const o = await orderRow(db);
    expect(await downloadOrder({ db: rpc, pack: UN, token: o.token, now: NOW })).toEqual({ ok: false, reason: "unpaid" });
    expect(await downloadOrder({ db: rpc, pack: UN, token: "../x", now: NOW })).toEqual({ ok: false, reason: "not_found" });
  });

  it("a paid order downloads its own encrypted PDF up to 5 times, for 7 days", async () => {
    const { db, rpc, o } = await paidOrder();
    const d = await downloadOrder({ db: rpc, pack: UN, token: o.token, now: NOW });
    if (!d.ok) throw new Error(d.reason);
    expect(d.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(d.pdf.toString("latin1")).toMatch(/\/Encrypt/);
    expect(d.fileName).toMatch(/^unique-names-girl-names-\d{4}-\d{2}-\d{2}-[0-9a-f]{6}\.pdf$/);
    for (let i = 2; i <= 5; i++) expect((await downloadOrder({ db: rpc, pack: UN, token: o.token, now: NOW })).ok).toBe(true);
    expect(await downloadOrder({ db: rpc, pack: UN, token: o.token, now: NOW })).toEqual({ ok: false, reason: "limit" });
    await db.exec(`update shop_orders set downloads = 0, paid_at = now() - interval '8 days'`);
    expect(await downloadOrder({ db: rpc, pack: UN, token: o.token, now: NOW })).toEqual({ ok: false, reason: "expired" });
  }, 60_000);
});
