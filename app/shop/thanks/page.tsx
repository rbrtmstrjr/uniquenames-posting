import type { Metadata } from "next";
import { activePack } from "@/packs";
import { anonShopDb } from "@/lib/shop/anon";
import { shopEnv } from "@/lib/shop/config";
import { orderStatus, TOKEN_RE } from "@/lib/shop/service";
import { ShopShell } from "@/components/shop/shop-view";
import { ThanksStatus } from "@/components/shop/thanks-status";

// /shop/thanks?o=<token>: where PayMongo sends the buyer back, and the link in the email. It never trusts the
// redirect: the order is read from the database (paid only by a verified webhook or the server's own PayMongo check).
// The token is the only key to the order: no referrer leaves this page, and search engines skip it.

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your order", referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function ThanksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pack = activePack();
  const env = shopEnv(pack.shop);
  const raw = (await searchParams).o;
  const token = typeof raw === "string" && TOKEN_RE.test(raw) ? raw : null;
  const t = pack.shop.copy.thanks;
  let r: Awaited<ReturnType<typeof orderStatus>> | null = null;
  if (token) r = await orderStatus({ db: anonShopDb(), pack, env, token, check: false, now: new Date() }).catch(() => null);
  return (
    <ShopShell brandName={pack.brand.name} logo={pack.brand.assets.logo ?? null}>
      <div className="mx-auto max-w-md rounded-3xl border border-line bg-surface p-6 shadow-soft">
        {r?.found && token ? (
          <ThanksStatus token={token} initial={r.view} copy={t} messenger={env.messenger} supportLine={pack.shop.copy.supportLine} />
        ) : (
          <div className="space-y-3">
            <h1 className="font-display text-3xl text-ink">{r === null && token ? "Please try again" : t.notFoundTitle}</h1>
            <p className="text-muted">{r === null && token ? "We could not check your order just now. Please reload this page in a minute." : t.notFoundText}</p>
            {env.messenger && <a href={env.messenger} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent">{pack.shop.copy.supportLine}</a>}
          </div>
        )}
      </div>
    </ShopShell>
  );
}
