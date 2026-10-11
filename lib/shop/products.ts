import type { PackShop, ShopProduct } from "@/packs/types";

// The names PDF shop's products and the buyer's form (brief 2026-10-11-shop). Pure and client-safe: no imports at run
// time. Prices are ALWAYS looked up here on the server from the pack; the browser only ever sends a product id.

export const SHOP_PRODUCTS: readonly ShopProduct[] = ["girl", "boy", "both"];
export const isShopProduct = (v: unknown): v is ShopProduct => typeof v === "string" && (SHOP_PRODUCTS as readonly string[]).includes(v);

/** The server-side price of a product (smallest unit, e.g. centavos) and its currency. */
export function priceOf(shop: Pick<PackShop, "products" | "currency">, product: ShopProduct): { amount: number; currency: string } {
  const amount = shop.products[product]?.price;
  if (!Number.isInteger(amount) || amount < 100) throw new Error(`No price for ${product}.`);
  return { amount, currency: shop.currency };
}

/** "₱50" / "₱100" (no decimals unless there are centavos). */
export function formatPrice(shop: Pick<PackShop, "currency" | "locale">, amount: number): string {
  const whole = amount % 100 === 0;
  return new Intl.NumberFormat(shop.locale, {
    style: "currency", currency: shop.currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
  }).format(amount / 100);
}

/** PayMongo's checkout payment_method_types we may ask for. */
export const PAYMONGO_METHODS = [
  "qrph", "gcash", "paymaya", "grab_pay", "shopee_pay", "card", "billease", "dob", "dob_ubp",
  "brankas_bdo", "brankas_landbank", "brankas_metrobank",
] as const;

/** The payment methods to offer: env SHOP_PAYMENT_METHODS ("qrph,gcash") when set, else the pack's; unknown ones dropped. */
export function paymentMethods(shop: Pick<PackShop, "paymentMethods">, envValue?: string | null): string[] {
  const raw = (envValue ?? "").trim() ? envValue!.split(",") : [...shop.paymentMethods];
  const out = [...new Set(raw.map((m) => m.trim().toLowerCase()).filter((m) => (PAYMONGO_METHODS as readonly string[]).includes(m)))];
  return out.length ? out : ["qrph"];
}

export const BUYER_NAME_MAX = 80;
export const FB_NAME_MAX = 80;
export const EMAIL_MAX = 254;
// one @, no spaces, a dot in the domain; the database checks the same shape
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const BAD_CHARS = /[\u0000-\u001f\u007f<>]/;
const tidy = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export type OrderForm = { product: ShopProduct; buyerName: string; email: string; fbName: string | null };
export type FormCheck = ({ ok: true } & OrderForm) | { ok: false; error: string; field: "product" | "buyerName" | "email" | "fbName" | "spam" };

/**
 * The buyer's form, checked: a product id (never a price), a name, an email and an optional Facebook name.
 * `website` is a honeypot: people never see it, bots fill it in.
 */
export function validateOrderForm(raw: unknown): FormCheck {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (tidy(r.website)) return { ok: false, error: "Something went wrong. Please reload the page and try again.", field: "spam" };
  if (!isShopProduct(r.product)) return { ok: false, error: "Choose Girl, Boy or both.", field: "product" };
  const buyerName = tidy(r.buyerName);
  if (buyerName.length < 2) return { ok: false, error: "Type your name.", field: "buyerName" };
  if (buyerName.length > BUYER_NAME_MAX) return { ok: false, error: `Keep your name under ${BUYER_NAME_MAX} characters.`, field: "buyerName" };
  if (BAD_CHARS.test(buyerName)) return { ok: false, error: "Your name has characters we can't use.", field: "buyerName" };
  const email = tidy(r.email).toLowerCase();
  if (email.length < 6 || email.length > EMAIL_MAX || !EMAIL_RE.test(email) || BAD_CHARS.test(email)) {
    return { ok: false, error: "Type a valid email. We send your PDF there.", field: "email" };
  }
  const fb = tidy(r.fbName);
  if (fb.length > FB_NAME_MAX) return { ok: false, error: `Keep your Facebook name under ${FB_NAME_MAX} characters.`, field: "fbName" };
  if (BAD_CHARS.test(fb)) return { ok: false, error: "Your Facebook name has characters we can't use.", field: "fbName" };
  return { ok: true, product: r.product, buyerName, email, fbName: fb || null };
}

/** The live name counts the shop shows ({girl} {boy} {single} {combo} in the pack's "What's inside" lines). */
export interface ShopCounts { girl_single: number; girl_combo: number; boy_single: number; boy_combo: number }
export function fillCounts(text: string, c: ShopCounts): string {
  const v: Record<string, number> = {
    girl: c.girl_single + c.girl_combo, boy: c.boy_single + c.boy_combo,
    single: c.girl_single + c.boy_single, combo: c.girl_combo + c.boy_combo,
  };
  return text.replace(/\{(girl|boy|single|combo)\}/g, (_, k: string) => v[k].toLocaleString("en-US"));
}

/** How many names a product holds. */
export const productCount = (c: ShopCounts, p: ShopProduct) =>
  (p !== "boy" ? c.girl_single + c.girl_combo : 0) + (p !== "girl" ? c.boy_single + c.boy_combo : 0);

/** "ma•••@gmail.com": enough for the buyer to recognise their address, nothing more. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "your email";
  return `${user.slice(0, Math.min(2, user.length))}•••@${domain}`;
}

/** Fill {name} {product} {email} in a shop text. */
export const fillShop = (text: string, v: Partial<Record<"name" | "product" | "email", string>>) =>
  text.replace(/\{(name|product|email)\}/g, (m, k: "name" | "product" | "email") => v[k] ?? m);
