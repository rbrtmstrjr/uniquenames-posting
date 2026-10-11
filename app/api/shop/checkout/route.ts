import { activePack } from "@/packs";
import { anonShopDb } from "@/lib/shop/anon";
import { shopEnv } from "@/lib/shop/config";
import { startCheckout } from "@/lib/shop/service";
import { getOwner } from "@/lib/supabase/server";

// POST /api/shop/checkout {product, buyerName, email, fbName?, website (honeypot)} -> {url} of the PayMongo checkout.
// Public (no login; lib/supabase/proxy isPublicPath) with LIVE keys; with TEST keys only the signed-in owner may order.
// The price is the pack's, never the browser's.

export const maxDuration = 30;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 4096) return json({ error: "That is too much text." }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "Please fill in the form." }, 400); }
  const pack = activePack();
  const r = await startCheckout({ db: anonShopDb(), pack, env: shopEnv(pack.shop), body, headers: req.headers, requestUrl: req.url,
    owner: async () => !!(await getOwner()) });
  return r.ok ? json({ url: r.url }) : json({ error: r.error, field: r.field }, r.status);
}
