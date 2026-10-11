import type { Metadata } from "next";
import { activePack } from "@/packs";
import { anonShopDb } from "@/lib/shop/anon";
import { shopEnv } from "@/lib/shop/config";
import { fillCounts, formatPrice, productCount } from "@/lib/shop/products";
import { shopState, type ShopState } from "@/lib/shop/service";
import { ShopView } from "@/components/shop/shop-view";

// /shop: the public names PDF shop (docs/SHOP.md). No login (lib/supabase/proxy isPublicPath). Before migration 019,
// without the PayMongo keys, before the shop key is linked, or while the owner's switch is off: "Coming soon".

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const pack = activePack();
  return {
    title: pack.shop.copy.metaTitle,
    description: pack.shop.copy.metaDescription,
    referrer: "no-referrer",
    openGraph: { title: pack.shop.copy.metaTitle, description: pack.shop.copy.metaDescription, ...(pack.shop.previews ? { images: [pack.shop.previews.cover] } : {}) },
  };
}

export default async function ShopPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pack = activePack();
  const env = shopEnv(pack.shop);
  const state: ShopState = await shopState(anonShopDb(), pack, env).catch(() => ({ open: false as const, reason: "error" as const, counts: null }));
  const counts = state.counts;
  const inside = pack.shop.copy.inside
    .filter((line) => counts || !/\{(girl|boy|single|combo)\}/.test(line))
    .map((line) => (counts ? fillCounts(line, counts) : line));
  const products = pack.shop.productOrder.map((id) => ({
    id, name: pack.shop.products[id].name, price: formatPrice(pack.shop, pack.shop.products[id].price), blurb: pack.shop.products[id].blurb,
    badge: pack.shop.products[id].badge, count: counts ? productCount(counts, id) : null,
  }));
  return (
    <ShopView
      brandName={pack.brand.name} logo={pack.brand.assets.logo ?? null} copy={pack.shop.copy} inside={inside} products={products}
      previews={pack.shop.previews} messenger={env.messenger} open={state.open} cancelled={(await searchParams).cancelled === "1"}
    />
  );
}
