import "server-only";
import type { NichePack, ShopProduct } from "@/packs/types";
import { UUID_RE } from "@/lib/actions/helpers";
import { newPassword } from "@/lib/pdf/password";
import { clientIp, ipHash, shopKey, siteUrl, type ShopEnv } from "./config";
import { buildOrderEmail, sendOrderEmail, type Mailer } from "./email";
import {
  createCheckoutSession, getCheckoutSession, readCheckoutSession, readWebhookEvent, verifySignature, type CheckoutInfo,
} from "./paymongo";
import { isShopProduct, maskEmail, priceOf, validateOrderForm, type ShopCounts } from "./products";
import { buildShopPdf, type ShopPdfName } from "./pdf";

// The names PDF shop's server logic (brief 2026-10-11-shop), framework-free so the tests drive it with a fake
// database and a fake PayMongo. The routes in app/shop and app/api are thin wrappers.
//
// Trust: the browser sends a product id and the buyer's details, nothing else. Prices come from the pack. An order
// becomes paid only from PayMongo itself: a webhook whose signature checks out, or the server reading the checkout
// session back from PayMongo with the secret key; never from the success redirect. Either way the paid amount and
// currency must equal the order's (and the pack's price for that product), and the database function demands the
// shop key that only this server has.

/** The database, as the anon key sees it: only the migration 019 functions. */
export interface ShopDb {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

type DbError = { message: string; code?: string } | null | undefined;
/** The functions of migration 019 are missing (not run yet). */
export const missing019 = (e: DbError) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || e.code === "PGRST205" || /could not find the function|function .* does not exist/i.test(e.message));

export interface ShopInfo { enabled: boolean; ready: boolean; counts: ShopCounts }
export type ShopState =
  | { open: true; testMode: boolean; counts: ShopCounts }
  | { open: false; reason: "pack" | "keys" | "migration" | "unlinked" | "paused" | "test" | "error"; counts: ShopCounts | null };

/**
 * Is the shop open? The pack sells, the PayMongo keys are set, migration 019 ran, the key linked in the database is
 * THIS server's key, and the owner's switch is on. With TEST keys the shop is never public: only the signed-in owner
 * can use it (a test payment would otherwise hand out the real PDF), even while the switch is off.
 */
export async function shopState(db: ShopDb, pack: NichePack, env: ShopEnv, o: { owner: boolean }): Promise<ShopState> {
  if (!pack.shop.enabled) return { open: false, reason: "pack", counts: null };
  const { data, error } = await db.rpc("shop_info", { p_secret: env.webhookSecret ? shopKey(env.webhookSecret) : null });
  if (error) return { open: false, reason: missing019(error) ? "migration" : "error", counts: null };
  const info = data as ShopInfo;
  if (!env.secretKey || !env.webhookSecret || !env.mode) return { open: false, reason: "keys", counts: info.counts };
  if (env.mode === "test" && !o.owner) return { open: false, reason: "test", counts: info.counts };
  if (!info.ready) return { open: false, reason: "unlinked", counts: info.counts };
  if (env.mode === "live" && !info.enabled) return { open: false, reason: "paused", counts: info.counts };
  return { open: true, testMode: env.mode === "test", counts: info.counts };
}

const TEMPORARILY = "The shop is temporarily unavailable. Please try again later.";
const CREATE_ERRORS: Record<string, { status: number; error: string }> = {
  closed: { status: 409, error: "The shop is closed right now. Please try again later." },
  forbidden: { status: 503, error: TEMPORARILY },
  invalid: { status: 400, error: "Please check your name and email." },
  rate_limited: { status: 429, error: "Too many orders from you in a short time. Please wait an hour, or message us for help." },
  busy: { status: 503, error: "Lots of orders right now. Please try again in a few minutes." },
};
const UNAVAILABLE = "Payment is not available right now. Please try again in a minute.";

export type StartResult = { ok: true; url: string } | { ok: false; status: number; error: string; field?: string };

/**
 * "Continue to payment": a pending order + a PayMongo Checkout Session for it; the buyer is sent to its URL.
 * `owner` is asked only with TEST keys: then only the signed-in owner may order (it also skips the shop switch).
 */
export async function startCheckout(i: {
  db: ShopDb; pack: NichePack; env: ShopEnv; body: unknown; headers: Headers; requestUrl: string; owner: () => Promise<boolean>; fetch?: typeof fetch;
}): Promise<StartResult> {
  const form = validateOrderForm(i.body);
  if (!form.ok) return { ok: false, status: 400, error: form.error, field: form.field };
  if (!i.pack.shop.enabled || !i.env.secretKey || !i.env.webhookSecret || !i.env.mode) return { ok: false, status: 409, error: CREATE_ERRORS.closed.error };
  const testMode = i.env.mode === "test";
  if (testMode && !(await i.owner().catch(() => false))) return { ok: false, status: 409, error: CREATE_ERRORS.closed.error };
  const key = shopKey(i.env.webhookSecret);
  const { amount, currency } = priceOf(i.pack.shop, form.product);
  const ip = clientIp(i.headers);
  const created = await i.db.rpc("create_shop_order", {
    p_pack: i.pack.id, p_product: form.product, p_amount: amount, p_currency: currency, p_buyer: form.buyerName,
    p_email: form.email, p_fb: form.fbName, p_ip_hash: ip ? ipHash(ip, key) : null, p_ignore_pause: testMode, p_secret: key,
  });
  if (created.error) {
    console.error("shop: create_shop_order failed:", created.error.code ?? created.error.message);
    return { ok: false, status: missing019(created.error) ? 409 : 500, error: missing019(created.error) ? CREATE_ERRORS.closed.error : UNAVAILABLE };
  }
  const c = created.data as { status: string; reason?: string; id?: string; token?: string };
  if (c.status !== "ok" || !c.id || !c.token) return { ok: false, ...(CREATE_ERRORS[c.reason ?? ""] ?? { status: 500, error: UNAVAILABLE }) };

  const base = siteUrl(i.env, i.requestUrl);
  const product = i.pack.shop.products[form.product];
  const session = await createCheckoutSession({
    secretKey: i.env.secretKey,
    lineItem: { name: product.name, amount, currency, description: i.pack.shop.copy.eyebrow },
    paymentMethods: i.env.paymentMethods,
    reference: c.id,
    successUrl: `${base}/shop/thanks?o=${c.token}`,
    cancelUrl: `${base}/shop?cancelled=1`,
    description: `${i.pack.shop.copy.eyebrow}: ${product.name}`,
    metadata: { order_id: c.id, product: form.product, pack: i.pack.id },
    billing: { name: form.buyerName, email: form.email },
  }, i.fetch);
  if (!session.ok) {
    console.error("shop: checkout session failed:", session.error);
    return { ok: false, status: 502, error: UNAVAILABLE };
  }
  const attached = await i.db.rpc("attach_shop_checkout", { p_order: c.id, p_checkout_id: session.value.id, p_secret: key });
  if (attached.error || attached.data !== true) {
    // the database does not accept this server's key (stale link) or failed: never send a buyer to pay then
    console.error("shop: could not keep the checkout id on the order:", attached.error?.code ?? "key not accepted");
    return { ok: false, status: 503, error: TEMPORARILY };
  }
  return { ok: true, url: session.value.url };
}

export interface PaidOrder { id: string; token: string; email: string; buyer_name: string; product: ShopProduct; password: string; pack: string }
export type FulfilResult =
  | { kind: "paid"; already: boolean; order: PaidOrder }
  | { kind: "ignored"; why: string }
  | { kind: "mismatch"; why: string }
  | { kind: "error"; why: string };

/**
 * A checkout session PayMongo says is paid -> the order is paid (once) with a fresh PDF password. Checks the paid
 * amount and currency against the pack's price for the product in the session's metadata, then the database checks
 * them against the order (and the session id). Idempotent.
 */
export async function fulfilSession(i: { db: ShopDb; pack: NichePack; env: ShopEnv; session: CheckoutInfo; password?: () => string }): Promise<FulfilResult> {
  const s = i.session;
  if (!s.paid) return { kind: "ignored", why: "no paid payment" };
  if (!s.reference || !UUID_RE.test(s.reference)) return { kind: "ignored", why: "not a shop order" };
  if (s.metadata.order_id !== s.reference) return { kind: "mismatch", why: "order id" };
  const product = s.metadata.product;
  if (!isShopProduct(product)) return { kind: "mismatch", why: "product" };
  const price = priceOf(i.pack.shop, product);
  if (s.paid.amount !== price.amount || s.paid.currency !== price.currency) return { kind: "mismatch", why: "amount" };
  if (!i.env.webhookSecret) return { kind: "error", why: "no webhook secret" };
  const { data, error } = await i.db.rpc("mark_shop_order_paid", {
    p_order: s.reference, p_checkout_id: s.id, p_payment_id: s.paid.id, p_amount: s.paid.amount, p_currency: s.paid.currency,
    p_product: product, p_password: (i.password ?? newPassword)(), p_secret: shopKey(i.env.webhookSecret),
  });
  if (error) return { kind: "error", why: error.code ?? "database" };
  const r = data as { status: string; reason?: string; already?: boolean } & Partial<PaidOrder>;
  if (r.status === "ok" && r.id && r.token && r.email && r.password && isShopProduct(r.product)) {
    return { kind: "paid", already: !!r.already, order: r as PaidOrder };
  }
  if (r.reason === "mismatch" || r.reason === "duplicate_payment") return { kind: "mismatch", why: r.reason };
  if (r.reason === "not_found") return { kind: "ignored", why: "unknown order" };
  return { kind: "error", why: r.reason ?? "unknown" };
}

/** Email the buyer their link and password (once per paid order) and note the result on the order. */
export async function deliverOrder(i: { db: ShopDb; pack: NichePack; env: ShopEnv; order: PaidOrder; baseUrl: string; mailer?: Mailer }): Promise<string | null> {
  if (!i.pack.shop.delivery.email) return "Email delivery is off for this page.";
  let problem: string | null;
  try {
    const email = buildOrderEmail({
      shop: i.pack.shop, colors: i.pack.pdf.colors, brandName: i.pack.brand.name, buyerName: i.order.buyer_name,
      product: i.order.product, link: `${i.baseUrl}/shop/thanks?o=${i.order.token}`, password: i.order.password,
    });
    problem = await sendOrderEmail({ smtp: i.env.smtp, brandName: i.pack.brand.name, to: i.order.email, email, mailer: i.mailer });
  } catch {
    problem = "The email could not be built.";
  }
  if (problem) console.warn("shop: order email not sent:", problem);
  if (i.env.webhookSecret) {
    const { error } = await i.db.rpc("note_shop_order_email", { p_order: i.order.id, p_error: problem, p_secret: shopKey(i.env.webhookSecret) });
    if (error) console.warn("shop: could not note the email result:", error.code ?? error.message);
  }
  return problem;
}

export interface WebhookOutcome { status: number; body: Record<string, unknown>; deliver: PaidOrder | null }

/** POST /api/paymongo/webhook: verify first (raw body), then only checkout_session.payment.paid in our mode is used. */
export async function handleWebhook(i: { db: ShopDb; pack: NichePack; env: ShopEnv; rawBody: string; signature: string | null; now: Date }): Promise<WebhookOutcome> {
  const none = (status: number, body: Record<string, unknown>): WebhookOutcome => ({ status, body, deliver: null });
  if (!i.env.webhookSecret || !i.env.mode) return none(503, { error: "not configured" });
  const v = verifySignature({ rawBody: i.rawBody, header: i.signature, secret: i.env.webhookSecret, mode: i.env.mode, now: i.now });
  if (!v.ok) return none(401, { error: "bad signature" });
  let parsed: unknown;
  try { parsed = JSON.parse(i.rawBody); } catch { return none(200, { ignored: "not json" }); }
  const event = readWebhookEvent(parsed);
  // PayMongo retries anything that is not 2xx: events we do not use are acknowledged and dropped
  if (!event || event.type !== "checkout_session.payment.paid") return none(200, { ignored: event?.type ?? "unknown" });
  if (event.livemode !== null && event.livemode !== (i.env.mode === "live")) return none(200, { ignored: "other mode" });
  const session = readCheckoutSession(event.resource);
  if (!session) return none(200, { ignored: "no session" });
  if (session.livemode !== null && session.livemode !== (i.env.mode === "live")) return none(200, { ignored: "other mode" });
  const r = await fulfilSession({ db: i.db, pack: i.pack, env: i.env, session });
  if (r.kind === "error") {
    console.error("shop webhook: could not mark paid:", r.why);
    return none(500, { error: "retry" });
  }
  if (r.kind === "mismatch") console.warn("shop webhook: payment does not match its order:", r.why, session.id);
  if (r.kind !== "paid") return none(200, { ignored: r.why });
  return { status: 200, body: { ok: true, already: r.already }, deliver: r.already ? null : r.order };
}

export const TOKEN_RE = /^[0-9a-f]{96}$/;

export interface StatusView {
  status: "pending" | "paid" | "failed" | "expired";
  product: ShopProduct;
  productName: string;
  password: string | null;
  email: string;
  emailed: boolean;
  downloads: number;
  maxDownloads: number;
  expiresAt: string | null;
  createdAt: string;
}
type StatusRow = {
  id: string; status: StatusView["status"]; product: ShopProduct; email: string; password: string | null; emailed: boolean;
  downloads: number; max_downloads: number; expires_at: string | null; created_at: string; checkout_id: string | null;
};

const view = (pack: NichePack, r: StatusRow): StatusView => ({
  status: r.status, product: r.product, productName: pack.shop.products[r.product]?.name ?? r.product, password: r.status === "paid" ? r.password : null,
  email: maskEmail(r.email), emailed: r.emailed, downloads: r.downloads, maxDownloads: r.max_downloads, expiresAt: r.expires_at, createdAt: r.created_at,
});

/**
 * The thanks page's poll. `check` = also ask PayMongo about a still-pending order (the page asks every ~15 s), so a
 * buyer gets the PDF even when the webhook is late. Returns the paid order to email when this call paid it.
 */
export async function orderStatus(i: { db: ShopDb; pack: NichePack; env: ShopEnv; token: string; check: boolean; now: Date; fetch?: typeof fetch }):
  Promise<{ found: false } | { found: true; view: StatusView; deliver: PaidOrder | null }> {
  if (!TOKEN_RE.test(i.token)) return { found: false };
  const { data, error } = await i.db.rpc("get_shop_order_status", { p_token: i.token });
  if (error) throw new Error(missing019(error) ? "The shop is not set up yet." : "Could not read the order.");
  if (!data) return { found: false };
  let row = data as StatusRow;
  let deliver: PaidOrder | null = null;
  const age = i.now.getTime() - new Date(row.created_at).getTime();
  if (i.check && row.status === "pending" && row.checkout_id && i.env.secretKey && i.env.webhookSecret && age > 10_000
    // the database allows one PayMongo read-back per order every 10 s, 60 in all
    && (await i.db.rpc("claim_shop_check", { p_token: i.token, p_secret: shopKey(i.env.webhookSecret) })).data === true) {
    const s = await getCheckoutSession(i.env.secretKey, row.checkout_id, i.fetch);
    if (s.ok && s.value.reference === row.id && (s.value.livemode === null || s.value.livemode === (i.env.mode === "live"))) {
      const r = await fulfilSession({ db: i.db, pack: i.pack, env: i.env, session: s.value });
      if (r.kind === "paid") {
        if (!r.already) deliver = r.order;
        const again = await i.db.rpc("get_shop_order_status", { p_token: i.token });
        if (!again.error && again.data) row = again.data as StatusRow;
      } else if (r.kind === "mismatch") console.warn("shop: payment does not match its order:", r.why);
    }
  }
  return { found: true, view: view(i.pack, row), deliver };
}

export type DownloadResult =
  | { ok: true; pdf: Buffer; fileName: string }
  | { ok: false; reason: "not_found" | "unpaid" | "expired" | "limit" | "empty" | "error" };

/**
 * POST /shop/download/<token>: the buyer's own PDF (paid, < 7 days, < 5 downloads). The database reserves the download;
 * when the PDF cannot be made the reservation is given back, so a failure never uses one up.
 */
export async function downloadOrder(i: { db: ShopDb; pack: NichePack; env: ShopEnv; token: string; now: Date }): Promise<DownloadResult> {
  if (!TOKEN_RE.test(i.token)) return { ok: false, reason: "not_found" };
  const { data, error } = await i.db.rpc("download_shop_order", { p_token: i.token });
  if (error) {
    console.error("shop: download_shop_order failed:", error.code ?? error.message);
    return { ok: false, reason: "error" };
  }
  const r = data as { status: string; reason?: string; product?: ShopProduct; buyer_name?: string; email?: string; password?: string; names?: ShopPdfName[] };
  if (r.status !== "ok") {
    const reason = r.reason as "not_found" | "unpaid" | "expired" | "limit";
    return { ok: false, reason: ["not_found", "unpaid", "expired", "limit"].includes(reason) ? reason : "error" };
  }
  const release = async () => {
    if (!i.env.webhookSecret) return;
    const { error: e } = await i.db.rpc("release_shop_download", { p_token: i.token, p_secret: shopKey(i.env.webhookSecret) });
    if (e) console.warn("shop: could not give the download back:", e.code ?? e.message);
  };
  if (!isShopProduct(r.product) || !r.password || !r.buyer_name || !r.email) { await release(); return { ok: false, reason: "error" }; }
  let built: Awaited<ReturnType<typeof buildShopPdf>>;
  try {
    built = await buildShopPdf({ pack: i.pack, product: r.product, buyerName: r.buyer_name, email: r.email, password: r.password, names: r.names ?? [], now: i.now });
  } catch (e) {
    console.error("shop: the PDF could not be made:", (e as Error).message);
    await release();
    return { ok: false, reason: "error" };
  }
  if (!built.ok) { await release(); return { ok: false, reason: "empty" }; }
  return { ok: true, pdf: built.pdf, fileName: built.fileName };
}
