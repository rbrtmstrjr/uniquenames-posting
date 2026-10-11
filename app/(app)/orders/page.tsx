import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { activePack } from "@/packs";
import { shopEnv, shopKey } from "@/lib/shop/config";
import { formatPrice } from "@/lib/shop/products";
import { revenueTotals, type OrderRow } from "@/lib/shop/orders";
import { missing019 } from "@/lib/shop/service";
import { PDF_STATUSES } from "@/lib/pdf/plan";
import { PageHeader } from "@/components/ui/page-header";
import { OrdersAdmin, type ShopSetup } from "@/components/shop/orders-admin";

// Orders (owner only, inside the app layout): the names PDF shop's sales (migration 019, docs/SHOP.md). Kept apart
// from Names > Past exports (PDFs the owner makes by hand): a shop download is never logged there.

export const dynamic = "force-dynamic";

/** Everything the page shows, read with the owner's session (RLS: owner only). */
async function loadOrders(now: Date) {
  const pack = activePack();
  const env = shopEnv(pack.shop);
  const sb = await createClient();
  const since = new Date(now.getTime() - 32 * 24 * 3600_000).toISOString();
  const [list, month, settings, unsorted, linked] = await Promise.all([
    sb.from("shop_orders").select("id, created_at, buyer_name, email, fb_name, product, amount, currency, status, paid_at, downloads, emailed_at, email_error")
      .order("created_at", { ascending: false }).limit(300),
    sb.from("shop_orders").select("status, paid_at, amount").eq("status", "paid").gte("paid_at", since),
    sb.from("settings").select("shop_enabled").eq("id", 1).maybeSingle(),
    sb.from("names").select("id", { count: "exact", head: true }).in("status", [...PDF_STATUSES]).is("meaning_category", null),
    env.webhookSecret ? sb.rpc("shop_secret_matches", { p_secret: shopKey(env.webhookSecret) }) : Promise.resolve({ data: false, error: null }),
  ]);
  if (list.error && !missing019(list.error)) throw new Error(list.error.message);
  // null = migration 019 has not run yet (the page says how to add it)
  const orders = list.error ? null : ((list.data ?? []) as OrderRow[]);
  const t = revenueTotals((month.data ?? []) as Pick<OrderRow, "status" | "paid_at" | "amount">[], now);
  const h = await headers();
  const origin = env.baseUrl ?? `https://${h.get("x-forwarded-host") ?? h.get("host") ?? "your-site.vercel.app"}`;
  const setup: ShopSetup = {
    packSells: pack.shop.enabled, keys: !!env.secretKey && !!env.mode, mode: env.mode, webhookSecret: !!env.webhookSecret,
    linked: linked.data === true, email: !!env.smtp, enabled: (settings.data as { shop_enabled?: boolean } | null)?.shop_enabled ?? false,
    unsorted: unsorted.count ?? 0, shopUrl: `${origin}/shop`, webhookUrl: `${origin}/api/paymongo/webhook`,
  };
  const money = Object.fromEntries((orders ?? []).map((o) => [o.id, formatPrice({ currency: o.currency, locale: pack.shop.locale }, o.amount)]));
  return { pack, orders, t, setup, money };
}

export default async function OrdersPage() {
  const now = new Date();
  const { pack, orders, t, setup, money } = await loadOrders(now);
  return (
    <>
      <PageHeader title="Orders" subtitle="Names PDF sales from your shop page. Payments by PayMongo; refunds and disputes are handled in the PayMongo dashboard." />
      <OrdersAdmin orders={orders} setup={setup} money={money} now={now.toISOString()}
        totals={{ today: formatPrice(pack.shop, t.today), todayCount: t.todayCount, month: formatPrice(pack.shop, t.month), monthCount: t.monthCount }} />
    </>
  );
}
