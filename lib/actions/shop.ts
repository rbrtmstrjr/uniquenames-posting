"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { activePack } from "@/packs";
import { shopEnv, shopKey } from "@/lib/shop/config";
import { buildOrderEmail, sendOrderEmail } from "@/lib/shop/email";
import { missing019 } from "@/lib/shop/service";
import { isShopProduct } from "@/lib/shop/products";
import { UUID_RE } from "./helpers";
import { fail, requireOwner, type ActionResult } from "./result";

// Orders page (names PDF shop, migration 019), owner only: reveal an order's PDF password, send its email again,
// switch the shop on / off, and link the server's shop key to the database (after setting PAYMONGO_WEBHOOK_SECRET).

const NEEDS_019 = "Run supabase/migrations/019_shop.sql first.";

export async function revealOrderPasswordAction(id: string): Promise<ActionResult<{ password: string }>> {
  await requireOwner();
  if (!UUID_RE.test(id)) return fail("Unknown order.");
  const sb = await createClient();
  const { data, error } = await sb.from("shop_orders").select("password, status").eq("id", id).maybeSingle();
  if (error) return fail(missing019(error) ? NEEDS_019 : error.message);
  const row = data as { password: string | null; status: string } | null;
  if (!row?.password || row.status !== "paid") return fail("This order is not paid, so it has no password yet.");
  return { ok: true, password: row.password };
}

/** Send the buyer's email again (link + password). Uses the owner's session to read the order. */
export async function resendOrderEmailAction(id: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(id)) return fail("Unknown order.");
  const pack = activePack();
  const env = shopEnv(pack.shop);
  if (!env.smtp) return fail("Email is not set up: add SMTP_USER and SMTP_PASS (a Gmail app password) in Vercel, then redeploy.");
  const sb = await createClient();
  const { data, error } = await sb.from("shop_orders").select("id, token, email, buyer_name, product, password, status").eq("id", id).maybeSingle();
  if (error) return fail(missing019(error) ? NEEDS_019 : error.message);
  const o = data as { id: string; token: string; email: string; buyer_name: string; product: string; password: string | null; status: string } | null;
  if (!o || o.status !== "paid" || !o.password || !isShopProduct(o.product)) return fail("Only paid orders have a PDF to send.");
  const base = env.baseUrl ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!base) return fail("Set SHOP_BASE_URL (your site's https address) so the email can link to the download.");
  const email = buildOrderEmail({
    shop: pack.shop, colors: pack.pdf.colors, brandName: pack.brand.name, buyerName: o.buyer_name, product: o.product,
    link: `${base}/shop/thanks?o=${o.token}`, password: o.password,
  });
  const problem = await sendOrderEmail({ smtp: env.smtp, brandName: pack.brand.name, to: o.email, email });
  await sb.from("shop_orders").update(problem ? { email_error: problem } : { emailed_at: new Date().toISOString(), email_error: null }).eq("id", id);
  revalidatePath("/orders");
  return problem ? fail(problem) : { ok: true };
}

export async function setShopEnabledAction(on: boolean): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { error } = await sb.from("settings").update({ shop_enabled: !!on }).eq("id", 1);
  if (error) return fail(missing019(error) || /shop_enabled/.test(error.message) ? NEEDS_019 : error.message);
  revalidatePath("/orders");
  revalidatePath("/shop");
  return { ok: true };
}

/** Store the hash of the server's shop key in the database, so the webhook can mark orders paid. */
export async function linkShopKeyAction(): Promise<ActionResult> {
  await requireOwner();
  const env = shopEnv(activePack().shop);
  if (!env.webhookSecret) return fail("Add PAYMONGO_WEBHOOK_SECRET in Vercel first (PayMongo shows it when you add the webhook), then redeploy.");
  const sb = await createClient();
  const { data, error } = await sb.rpc("set_shop_secret", { p_secret: shopKey(env.webhookSecret) });
  if (error) return fail(missing019(error) ? NEEDS_019 : error.message);
  if (data !== true) return fail("The database did not take the key.");
  revalidatePath("/orders");
  revalidatePath("/shop");
  return { ok: true };
}
