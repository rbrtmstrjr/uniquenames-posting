import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { PackShop } from "@/packs/types";
import { keyMode, type KeyMode } from "./paymongo";
import { paymentMethods } from "./products";

// The shop's server settings, all from env (Vercel): PayMongo keys, the webhook secret, Gmail SMTP and the site's
// address. Nothing here is ever sent to the browser except booleans ("is it set?") on the owner's Orders page.

export interface ShopEnv {
  secretKey: string | null;
  webhookSecret: string | null;
  /** test / live, from the secret key's prefix; null = no usable key. */
  mode: KeyMode | null;
  paymentMethods: string[];
  smtp: { user: string; pass: string; from: string } | null;
  /** https://… without a trailing slash; null = use the request's own origin. */
  baseUrl: string | null;
  messenger: string | null;
}

const clean = (v: string | undefined) => (v ?? "").trim() || null;

export function shopEnv(shop: Pick<PackShop, "paymentMethods" | "messenger">, env: Record<string, string | undefined> = process.env): ShopEnv {
  const secretKey = clean(env.PAYMONGO_SECRET_KEY);
  const user = clean(env.SMTP_USER);
  const pass = clean(env.SMTP_PASS)?.replace(/\s+/g, "") ?? null; // Gmail shows app passwords in groups of four
  const base = clean(env.SHOP_BASE_URL) ?? (clean(env.VERCEL_PROJECT_PRODUCTION_URL) ? `https://${clean(env.VERCEL_PROJECT_PRODUCTION_URL)}` : null);
  const messenger = clean(env.SHOP_MESSENGER_URL) ?? shop.messenger;
  return {
    secretKey,
    webhookSecret: clean(env.PAYMONGO_WEBHOOK_SECRET),
    mode: keyMode(secretKey),
    paymentMethods: paymentMethods(shop, env.SHOP_PAYMENT_METHODS),
    smtp: user && pass ? { user, pass, from: clean(env.SMTP_FROM) ?? user } : null,
    baseUrl: base && /^https?:\/\/[^/\s]+$/.test(base.replace(/\/+$/, "")) ? base.replace(/\/+$/, "") : null,
    messenger: messenger && /^https:\/\/(m\.me|www\.facebook\.com|facebook\.com|www\.messenger\.com)\//.test(messenger) ? messenger : null,
  };
}

/**
 * The shop key the server shows the database (migration 019: mark paid, attach checkout, note email). Derived from the
 * webhook secret, so there is no extra env var; the database keeps only its SHA-256. Changing the webhook secret
 * (test -> live) needs Orders > Link payments once.
 */
export const shopKey = (webhookSecret: string) => createHmac("sha256", webhookSecret).update("names-pdf-shop/db-key/v1").digest("hex");

/** A buyer's network for the rate limit: the IP, hashed with the shop key (never stored as is). */
export const ipHash = (ip: string, salt: string) => createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32);

/** The client IP behind Vercel's proxy (first x-forwarded-for hop), or null. */
export function clientIp(h: Headers): string | null {
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || (h.get("x-real-ip") ?? "").trim();
  return ip && ip.length <= 64 ? ip : null;
}

/** The site's address for links (success / cancel / email): SHOP_BASE_URL or Vercel's production URL, else the request. */
export const siteUrl = (env: Pick<ShopEnv, "baseUrl">, requestUrl: string) => env.baseUrl ?? new URL(requestUrl).origin;
