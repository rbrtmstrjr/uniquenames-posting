import { after } from "next/server";
import { activePack } from "@/packs";
import { anonShopDb } from "@/lib/shop/anon";
import { shopEnv, siteUrl } from "@/lib/shop/config";
import { deliverOrder, handleWebhook } from "@/lib/shop/service";

// POST /api/paymongo/webhook: PayMongo's checkout_session.payment.paid (register this URL in the PayMongo dashboard,
// docs/SHOP.md). The signature is checked on the RAW body before anything else; the email goes out after the answer
// (PayMongo wants a reply within 30 s). Anything we do not use gets 200 so PayMongo does not retry it.

export const maxDuration = 30;

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (rawBody.length > 1_000_000) return Response.json({ error: "too large" }, { status: 413 });
  const pack = activePack();
  const env = shopEnv(pack.shop);
  const db = anonShopDb();
  const r = await handleWebhook({ db, pack, env, rawBody, signature: req.headers.get("paymongo-signature"), now: new Date() });
  const paid = r.deliver;
  if (paid) after(() => deliverOrder({ db, pack, env, order: paid, baseUrl: siteUrl(env, req.url) }).then(() => undefined));
  return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
