import { after } from "next/server";
import { activePack } from "@/packs";
import { anonShopDb } from "@/lib/shop/anon";
import { shopEnv, siteUrl } from "@/lib/shop/config";
import { deliverOrder, orderStatus } from "@/lib/shop/service";

// GET /api/shop/status?o=<token>[&check=1] -> the thanks page's view of the order (the password once paid).
// check=1 also asks PayMongo about a still-pending order (never trusting the success redirect itself).

export const maxDuration = 30;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("o") ?? "";
  const pack = activePack();
  const env = shopEnv(pack.shop);
  const db = anonShopDb();
  try {
    const r = await orderStatus({ db, pack, env, token, check: url.searchParams.get("check") === "1", now: new Date() });
    if (!r.found) return json({ error: "not found" }, 404);
    const paid = r.deliver;
    if (paid) after(() => deliverOrder({ db, pack, env, order: paid, baseUrl: siteUrl(env, req.url) }).then(() => undefined));
    return json(r.view);
  } catch {
    return json({ error: "Could not check the order. Please try again." }, 503);
  }
}
