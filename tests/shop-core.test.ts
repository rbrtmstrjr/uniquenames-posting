import { describe, expect, it } from "vitest";
import { packById } from "@/packs";
import {
  fillCounts, formatPrice, maskEmail, paymentMethods, priceOf, productCount, validateOrderForm,
} from "@/lib/shop/products";
import {
  keyMode, parseSignatureHeader, readCheckoutSession, readWebhookEvent, signPayload, verifySignature,
} from "@/lib/shop/paymongo";
import { clientIp, ipHash, shopEnv, shopKey, siteUrl } from "@/lib/shop/config";
import { buildOrderEmail, sendOrderEmail } from "@/lib/shop/email";
import { buyerStamp } from "@/lib/shop/pdf";

const UN = packById("unique-names");
const NN = packById("name-nest");

describe("products and prices (server side only)", () => {
  it("Unique Names sells Girl ₱50, Boy ₱50, Both ₱100 in PHP; Name Nest is off", () => {
    expect(UN.shop.enabled).toBe(true);
    expect(NN.shop.enabled).toBe(false);
    expect(priceOf(UN.shop, "girl")).toEqual({ amount: 5000, currency: "PHP" });
    expect(priceOf(UN.shop, "boy")).toEqual({ amount: 5000, currency: "PHP" });
    expect(priceOf(UN.shop, "both")).toEqual({ amount: 10000, currency: "PHP" });
    expect(formatPrice(UN.shop, 5000)).toBe("₱50");
    expect(formatPrice(UN.shop, 10000)).toBe("₱100");
    expect(formatPrice(UN.shop, 4950)).toBe("₱49.50");
  });

  it("payment methods: the pack's QR Ph by default, env may add more, unknown ones are dropped", () => {
    expect(paymentMethods(UN.shop)).toEqual(["qrph"]);
    expect(paymentMethods(UN.shop, "")).toEqual(["qrph"]);
    expect(paymentMethods(UN.shop, "qrph, GCash ,paymaya,bitcoin,qrph")).toEqual(["qrph", "gcash", "paymaya"]);
    expect(paymentMethods(UN.shop, "bitcoin")).toEqual(["qrph"]);
  });

  it("checks the form: product id, name, email, optional Facebook name; the honeypot stops bots", () => {
    const ok = { product: "girl", buyerName: "  Maria   Santos ", email: " Maria@Example.com ", fbName: "" };
    expect(validateOrderForm(ok)).toEqual({ ok: true, product: "girl", buyerName: "Maria Santos", email: "maria@example.com", fbName: null });
    expect(validateOrderForm({ ...ok, fbName: "Maria S." })).toMatchObject({ ok: true, fbName: "Maria S." });
    for (const [bad, field] of [
      [{ product: "girls" }, "product"], [{ product: undefined }, "product"], [{ buyerName: "M" }, "buyerName"], [{ buyerName: "x".repeat(81) }, "buyerName"],
      [{ buyerName: "<b>Maria</b>" }, "buyerName"], [{ email: "maria" }, "email"], [{ email: "a@b" }, "email"], [{ email: "m a@x.com" }, "email"],
      [{ fbName: "y".repeat(81) }, "fbName"], [{ website: "http://spam" }, "spam"],
    ] as const) {
      expect(validateOrderForm({ ...ok, ...bad }), JSON.stringify(bad)).toMatchObject({ ok: false, field });
    }
    expect(validateOrderForm(null)).toMatchObject({ ok: false });
  });

  it("a price sent by the browser is never read", () => {
    const r = validateOrderForm({ product: "both", buyerName: "Maria", email: "maria@example.com", amount: 1, price: 1, currency: "USD" });
    expect(r).toEqual({ ok: true, product: "both", buyerName: "Maria", email: "maria@example.com", fbName: null });
  });

  it("fills live counts and masks emails", () => {
    const c = { girl_single: 120, girl_combo: 80, boy_single: 1100, boy_combo: 50 };
    expect(fillCounts("{girl} girl and {boy} boy · {single}/{combo}", c)).toBe("200 girl and 1,150 boy · 1,220/130");
    expect(productCount(c, "girl")).toBe(200);
    expect(productCount(c, "both")).toBe(1350);
    expect(maskEmail("maria.santos@gmail.com")).toBe("ma•••@gmail.com");
    expect(maskEmail("a@x.co")).toBe("a•••@x.co");
  });
});

describe("PayMongo webhook signature", () => {
  const secret = "whsk_test_secret";
  const body = JSON.stringify({ data: { id: "evt_1", attributes: { type: "checkout_session.payment.paid" } } });
  const now = new Date("2026-10-11T12:00:00Z");
  const t = Math.floor(now.getTime() / 1000);
  const sig = signPayload(secret, t, body);

  it("accepts the right signature for the mode (te = test, li = live)", () => {
    expect(verifySignature({ rawBody: body, header: `t=${t},te=${sig},li=`, secret, mode: "test", now })).toEqual({ ok: true, timestamp: t });
    expect(verifySignature({ rawBody: body, header: `t=${t},te=,li=${sig}`, secret, mode: "live", now })).toEqual({ ok: true, timestamp: t });
    // the test signature never passes for live keys (and back)
    expect(verifySignature({ rawBody: body, header: `t=${t},te=${sig},li=`, secret, mode: "live", now })).toMatchObject({ ok: false, reason: "mismatch" });
  });

  it("rejects a missing / malformed header, a wrong secret, a changed body or a changed timestamp", () => {
    expect(verifySignature({ rawBody: body, header: null, secret, mode: "test", now })).toEqual({ ok: false, reason: "missing" });
    expect(verifySignature({ rawBody: body, header: "garbage", secret, mode: "test", now })).toEqual({ ok: false, reason: "malformed" });
    expect(verifySignature({ rawBody: body, header: `te=${sig}`, secret, mode: "test", now })).toEqual({ ok: false, reason: "malformed" });
    expect(verifySignature({ rawBody: body, header: `t=${t},te=${sig},li=`, secret: "other", mode: "test", now })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifySignature({ rawBody: body + " ", header: `t=${t},te=${sig},li=`, secret, mode: "test", now })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifySignature({ rawBody: body, header: `t=${t + 1},te=${sig},li=`, secret, mode: "test", now })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifySignature({ rawBody: body, header: `t=${t},te=${sig.slice(0, 63)},li=`, secret, mode: "test", now })).toMatchObject({ ok: false, reason: "mismatch" });
  });

  it("rejects a replayed (old) or future-dated request", () => {
    const old = t - 301;
    const oldSig = signPayload(secret, old, body);
    expect(verifySignature({ rawBody: body, header: `t=${old},te=${oldSig},li=`, secret, mode: "test", now })).toEqual({ ok: false, reason: "stale" });
    const future = t + 301;
    expect(verifySignature({ rawBody: body, header: `t=${future},te=${signPayload(secret, future, body)},li=`, secret, mode: "test", now }))
      .toEqual({ ok: false, reason: "stale" });
    const recent = t - 120;
    expect(verifySignature({ rawBody: body, header: `t=${recent},te=${signPayload(secret, recent, body)},li=`, secret, mode: "test", now }).ok).toBe(true);
  });

  it("parses the header in any order", () => {
    expect(parseSignatureHeader("li=b,te=a,t=5")).toEqual({ t: 5, te: "a", li: "b" });
    expect(parseSignatureHeader("t=abc,te=,li=")).toBeNull();
  });

  it("keyMode reads the secret key's prefix", () => {
    expect(keyMode("sk_test_abc")).toBe("test");
    expect(keyMode("sk_live_abc")).toBe("live");
    expect(keyMode("pk_test_abc")).toBeNull();
    expect(keyMode(undefined)).toBeNull();
  });
});

describe("PayMongo payloads", () => {
  const session = {
    id: "cs_123", type: "checkout_session",
    attributes: {
      reference_number: "11111111-1111-4111-8111-111111111111", livemode: false, metadata: { order_id: "11111111-1111-4111-8111-111111111111", product: "girl", n: 5 },
      payments: [
        { id: "pay_failed", attributes: { amount: 5000, currency: "PHP", status: "failed" } },
        { id: "pay_ok", attributes: { amount: 5000, currency: "php", status: "paid" } },
      ],
    },
  };
  it("reads a checkout session: the first PAID payment, string metadata only", () => {
    expect(readCheckoutSession(session)).toEqual({
      id: "cs_123", reference: "11111111-1111-4111-8111-111111111111", livemode: false,
      metadata: { order_id: "11111111-1111-4111-8111-111111111111", product: "girl" }, paid: { id: "pay_ok", amount: 5000, currency: "PHP" },
    });
    expect(readCheckoutSession({ ...session, id: "pi_1" })).toBeNull();
    expect(readCheckoutSession(null)).toBeNull();
    expect(readCheckoutSession({ ...session, attributes: { ...session.attributes, payments: [] } })?.paid).toBeNull();
  });

  it("reads both documented event envelopes", () => {
    expect(readWebhookEvent({ data: { id: "evt_1", type: "event", attributes: { type: "checkout_session.payment.paid", livemode: false, data: session } } }))
      .toEqual({ id: "evt_1", type: "checkout_session.payment.paid", livemode: false, resource: session });
    expect(readWebhookEvent({ event_type: "send.webhook", data: { type: "checkout_session.payment.paid", livemode: true, data: session } }))
      .toEqual({ id: null, type: "checkout_session.payment.paid", livemode: true, resource: session });
    expect(readWebhookEvent({ data: { id: "cs_1", type: "checkout_session", attributes: {} } })).toBeNull();
    expect(readWebhookEvent("x")).toBeNull();
  });
});

describe("shop env and keys", () => {
  it("reads env, never trusting odd values", () => {
    const e = shopEnv(UN.shop, {
      PAYMONGO_SECRET_KEY: "sk_test_x", PAYMONGO_WEBHOOK_SECRET: "whsk_x", SMTP_USER: "me@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop",
      SHOP_BASE_URL: "https://shop.example.com/", SHOP_MESSENGER_URL: "https://m.me/uniquenames",
    });
    expect(e).toMatchObject({ mode: "test", paymentMethods: ["qrph"], smtp: { user: "me@gmail.com", pass: "abcdefghijklmnop", from: "me@gmail.com" }, baseUrl: "https://shop.example.com", messenger: "https://m.me/uniquenames" });
    expect(shopEnv({ ...UN.shop, messenger: null }, { SHOP_MESSENGER_URL: "javascript:alert(1)", SHOP_BASE_URL: "not a url" })).toMatchObject({ messenger: null, baseUrl: null, smtp: null, mode: null });
    expect(shopEnv(UN.shop, { VERCEL_PROJECT_PRODUCTION_URL: "un.vercel.app" }).baseUrl).toBe("https://un.vercel.app");
    // the pack's own help link (page id; no username), unless env overrides it
    expect(UN.shop.messenger).toBe("https://m.me/61572452954153");
    expect(shopEnv(UN.shop, {}).messenger).toBe("https://m.me/61572452954153");
    expect(siteUrl({ baseUrl: null }, "https://x.vercel.app/api/shop/checkout")).toBe("https://x.vercel.app");
  });

  it("the database key is derived from the webhook secret, 64 hex, stable", () => {
    expect(shopKey("whsk_a")).toMatch(/^[0-9a-f]{64}$/);
    expect(shopKey("whsk_a")).toBe(shopKey("whsk_a"));
    expect(shopKey("whsk_a")).not.toBe(shopKey("whsk_b"));
    expect(ipHash("1.2.3.4", "salt")).toMatch(/^[0-9a-f]{32}$/);
    expect(ipHash("1.2.3.4", "salt")).not.toBe(ipHash("1.2.3.4", "other"));
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe("delivery email", () => {
  const input = {
    shop: UN.shop, colors: UN.pdf.colors, brandName: "Unique Names", buyerName: "Maria <b>Santos</b>", product: "both" as const,
    link: "https://un.example.com/shop/thanks?o=" + "a".repeat(96), password: "Kp7m-Xr4d-Tq9w",
  };
  it("has the link, the password and the product; buyer text is escaped", () => {
    const m = buildOrderEmail(input);
    expect(m.subject).toBe("Your Unique Names PDF is ready");
    expect(m.html).toContain(`href="${input.link}"`);
    expect(m.html).toContain("Kp7m-Xr4d-Tq9w");
    expect(m.html).toContain("Girl &amp; Boy Bundle");
    expect(m.html).toContain("Hi Maria,");
    expect(m.html).not.toContain("<b>");
    expect(m.html).toContain(UN.pdf.colors.accent);
    expect(m.text).toContain(input.link);
    expect(m.text).toContain("Your PDF password: Kp7m-Xr4d-Tq9w");
    expect(() => buildOrderEmail({ ...input, link: "javascript:alert(1)" })).toThrow();
  });

  it("skips gracefully without SMTP, reports send errors without the address", async () => {
    const m = buildOrderEmail(input);
    expect(await sendOrderEmail({ smtp: null, brandName: "UN", to: "maria@example.com", email: m })).toMatch(/not set up/);
    const sent: unknown[] = [];
    const smtp = { user: "me@gmail.com", pass: "x", from: "me@gmail.com" };
    expect(await sendOrderEmail({ smtp, brandName: "Unique Names", to: "maria@example.com", email: m, mailer: async (msg) => { sent.push(msg); } })).toBeNull();
    expect(sent).toEqual([expect.objectContaining({ from: "Unique Names <me@gmail.com>", to: "maria@example.com", subject: m.subject })]);
    const err = await sendOrderEmail({ smtp, brandName: "UN", to: "maria@example.com", email: m, mailer: async () => { throw Object.assign(new Error("rejected maria@example.com"), { code: "EAUTH" }); } });
    expect(err).toBe("The email could not be sent (EAUTH).");
  });

  it("stamps the buyer's name and email on the PDF, within 120 characters", () => {
    expect(buyerStamp("Maria Santos", "maria@example.com")).toBe("Maria Santos (maria@example.com)");
    expect(buyerStamp("M".repeat(80), "x".repeat(60) + "@example.com").length).toBeLessThanOrEqual(120);
  });
});
