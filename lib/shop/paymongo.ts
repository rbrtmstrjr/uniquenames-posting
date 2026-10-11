import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// PayMongo for the names PDF shop: create a Checkout Session (v2), read one back (v1 retrieve), and verify + read the
// checkout_session.payment.paid webhook. Plain fetch, no SDK. Official docs (2026-10):
// * POST https://api.paymongo.com/v2/checkout_sessions, HTTP Basic with the secret key as the user name and an empty
//   password; body {data: {attributes: {line_items[{name, amount (centavos), currency, quantity}], payment_method_types,
//   reference_number, success_url, cancel_url, description, metadata (string values), billing, send_email_receipt}}};
//   answers {data: {id: "cs_…", attributes: {checkout_url, livemode}}}.
// * GET https://api.paymongo.com/v1/checkout_sessions/{id}: attributes.status, reference_number, metadata, payments[].
// * Webhook header "Paymongo-Signature: t=<unix>,te=<test sig>,li=<live sig>". Signature = hex HMAC-SHA256 of
//   "<t>.<raw body>" with the webhook's secret key; compare with te for test events, li for live ones; an old t may be
//   a replay (docs.paymongo.com/docs/developer-tools-webhook-setup-management#securing-a-webhook).

export const PAYMONGO_API = "https://api.paymongo.com";
/** How old (or how far in the future) a signed webhook may be. Replays inside it are harmless: paying is idempotent. */
export const SIGNATURE_TOLERANCE_S = 300;

export type KeyMode = "test" | "live";
/** Which mode a secret key works in (sk_test_… / sk_live_…); null = not a PayMongo secret key. */
export function keyMode(secretKey: string | undefined | null): KeyMode | null {
  if (!secretKey) return null;
  if (secretKey.startsWith("sk_live_")) return "live";
  if (secretKey.startsWith("sk_test_")) return "test";
  return null;
}

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: "missing" | "malformed" | "mismatch" | "stale" };

/** Parse "t=…,te=…,li=…" (order-free; empty values allowed). */
export function parseSignatureHeader(header: string | null | undefined): { t: number; te: string; li: string } | null {
  if (!header) return null;
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i <= 0) return null;
    parts.set(piece.slice(0, i).trim(), piece.slice(i + 1).trim());
  }
  const t = Number(parts.get("t"));
  if (!parts.has("t") || !Number.isInteger(t) || t <= 0) return null;
  return { t, te: parts.get("te") ?? "", li: parts.get("li") ?? "" };
}

/** The signature PayMongo puts in te / li for a body sent at time t. */
export const signPayload = (secret: string, t: number, rawBody: string) =>
  createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");

/**
 * Verify a webhook: the raw body (exactly the bytes received), the header, the webhook's secret and the mode we run in
 * (test keys check te, live keys check li). Constant-time compare; a timestamp outside the tolerance is "stale".
 */
export function verifySignature(i: { rawBody: string; header: string | null | undefined; secret: string; mode: KeyMode; now: Date; toleranceS?: number }): SignatureCheck {
  if (!i.header) return { ok: false, reason: "missing" };
  const h = parseSignatureHeader(i.header);
  if (!h) return { ok: false, reason: "malformed" };
  const given = i.mode === "live" ? h.li : h.te;
  if (!/^[0-9a-f]{64}$/i.test(given)) return { ok: false, reason: "mismatch" };
  const want = signPayload(i.secret, h.t, i.rawBody);
  if (!timingSafeEqual(Buffer.from(want, "hex"), Buffer.from(given.toLowerCase(), "hex"))) return { ok: false, reason: "mismatch" };
  const tolerance = i.toleranceS ?? SIGNATURE_TOLERANCE_S;
  if (Math.abs(Math.floor(i.now.getTime() / 1000) - h.t) > tolerance) return { ok: false, reason: "stale" };
  return { ok: true, timestamp: h.t };
}

/** A checkout session, reduced to what the shop needs. */
export interface CheckoutInfo {
  id: string;
  reference: string | null;
  metadata: Record<string, string>;
  livemode: boolean | null;
  /** The first paid payment, if any. */
  paid: { id: string; amount: number; currency: string } | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** A checkout session resource ({id, attributes}) as CheckoutInfo; null when it is not one. */
export function readCheckoutSession(resource: unknown): CheckoutInfo | null {
  const r = obj(resource);
  const a = obj(r?.attributes);
  const id = str(r?.id);
  if (!r || !a || !id || !id.startsWith("cs_")) return null;
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(a.metadata) ?? {})) if (typeof v === "string") metadata[k] = v;
  let paid: CheckoutInfo["paid"] = null;
  for (const p of Array.isArray(a.payments) ? a.payments : []) {
    const pa = obj(obj(p)?.attributes);
    const pid = str(obj(p)?.id);
    if (pid && pa && pa.status === "paid" && Number.isInteger(pa.amount) && typeof pa.currency === "string") {
      paid = { id: pid, amount: pa.amount as number, currency: (pa.currency as string).toUpperCase() };
      break;
    }
  }
  return { id, reference: str(a.reference_number), metadata, livemode: typeof a.livemode === "boolean" ? a.livemode : null, paid };
}

export interface WebhookEvent { id: string | null; type: string; livemode: boolean | null; resource: unknown }

/**
 * A webhook body as {id, type, livemode, resource}. PayMongo's documented envelope is {data: {id: "evt_…",
 * attributes: {type, livemode, data: <resource>}}}; the Hosted Checkout page also shows {data: {type, livemode,
 * data: <resource>}}; both are read. null = not an event.
 */
export function readWebhookEvent(body: unknown): WebhookEvent | null {
  const d = obj(obj(body)?.data);
  if (!d) return null;
  const a = obj(d.attributes);
  if (a && typeof a.type === "string") {
    return { id: str(d.id), type: a.type, livemode: typeof a.livemode === "boolean" ? a.livemode : null, resource: a.data };
  }
  if (typeof d.type === "string" && d.type.includes(".")) {
    return { id: str(d.id), type: d.type, livemode: typeof d.livemode === "boolean" ? d.livemode : null, resource: d.data };
  }
  return null;
}

type Fetch = typeof fetch;
const auth = (secretKey: string) => `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;

export interface CreateCheckoutInput {
  secretKey: string;
  lineItem: { name: string; amount: number; currency: string; description?: string };
  paymentMethods: string[];
  reference: string;
  successUrl: string;
  cancelUrl: string;
  description: string;
  metadata: Record<string, string>;
  billing: { name: string; email: string };
}

export type PaymongoResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/** PayMongo's error answer, short and without values (it may echo what we sent). */
function errorOf(status: number, body: unknown): string {
  const first = Array.isArray(obj(body)?.errors) ? obj((obj(body)!.errors as unknown[])[0]) : null;
  const code = str(first?.code);
  return `PayMongo ${status}${code ? ` (${code})` : ""}`;
}

/** Create a Checkout Session (v2). */
export async function createCheckoutSession(i: CreateCheckoutInput, f: Fetch = fetch): Promise<PaymongoResult<{ id: string; url: string; livemode: boolean | null }>> {
  let res: Response;
  try {
    res = await f(`${PAYMONGO_API}/v2/checkout_sessions`, {
      method: "POST",
      headers: { Authorization: auth(i.secretKey), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [{ name: i.lineItem.name, amount: i.lineItem.amount, currency: i.lineItem.currency, quantity: 1, ...(i.lineItem.description ? { description: i.lineItem.description } : {}) }],
            payment_method_types: i.paymentMethods,
            reference_number: i.reference,
            success_url: i.successUrl,
            cancel_url: i.cancelUrl,
            description: i.description,
            metadata: i.metadata,
            billing: i.billing,
            send_email_receipt: true,
            show_description: true,
            show_line_items: true,
          },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, status: 0, error: "PayMongo did not answer" };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, error: errorOf(res.status, body) };
  const d = obj(obj(body)?.data);
  const id = str(d?.id);
  const url = str(obj(d?.attributes)?.checkout_url);
  if (!id || !url || !/^https:\/\//.test(url)) return { ok: false, status: res.status, error: "PayMongo sent no checkout link" };
  const live = obj(d?.attributes)?.livemode;
  return { ok: true, value: { id, url, livemode: typeof live === "boolean" ? live : null } };
}

/** Read a Checkout Session back (to confirm a payment ourselves when no webhook has arrived yet). */
export async function getCheckoutSession(secretKey: string, id: string, f: Fetch = fetch): Promise<PaymongoResult<CheckoutInfo>> {
  if (!/^cs_[A-Za-z0-9_]{1,96}$/.test(id)) return { ok: false, status: 400, error: "Bad checkout id" };
  let res: Response;
  try {
    res = await f(`${PAYMONGO_API}/v1/checkout_sessions/${id}`, {
      headers: { Authorization: auth(secretKey), Accept: "application/json" }, signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, error: "PayMongo did not answer" };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, error: errorOf(res.status, body) };
  const info = readCheckoutSession(obj(body)?.data);
  return info ? { ok: true, value: info } : { ok: false, status: res.status, error: "Not a checkout session" };
}
