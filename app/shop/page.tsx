import type { Metadata } from "next";
import { activePack } from "@/packs";
import { anonShopDb } from "@/lib/shop/anon";
import { shopEnv } from "@/lib/shop/config";
import { fillCounts, formatPrice, productCount } from "@/lib/shop/products";
import { shopState, type ShopState } from "@/lib/shop/service";
import { ShopView } from "@/components/shop/shop-view";
import { galleryImages } from "@/components/shop/shop-gallery";
import { getOwner } from "@/lib/supabase/server";

// /shop: the public names PDF shop (docs/SHOP.md). No login (lib/supabase/proxy isPublicPath). Before migration 019,
// without the PayMongo keys, before the shop key is linked, or while the owner's switch is off: "Coming soon".
// With TEST keys only the signed-in owner sees the shop (with a test-mode banner); everyone else sees "Coming soon".

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
  // the owner's session is only looked at with test keys
  const owner = env.mode === "test" ? !!(await getOwner().catch(() => null)) : false;
  const state: ShopState = await shopState(anonShopDb(), pack, env, { owner }).catch(() => ({ open: false as const, reason: "error" as const, counts: null }));
  const counts = state.counts;
  const inside = pack.shop.copy.inside
    .filter((line) => counts || !/\{(girl|boy|single|combo)\}/.test(line))
    .map((line) => (counts ? fillCounts(line, counts) : line));
  const products = pack.shop.productOrder.map((id) => ({
    id, name: pack.shop.products[id].name, price: formatPrice(pack.shop, pack.shop.products[id].price), blurb: pack.shop.products[id].blurb,
    badge: pack.shop.products[id].badge, count: counts ? productCount(counts, id) : null,
  }));
  const cheapest = pack.shop.productOrder.reduce((a, b) => (pack.shop.products[b].price < pack.shop.products[a].price ? b : a));
  const gallery = galleryImages(pack.shop.gallery);
  return (
    <ShopView
      brandName={pack.brand.name} logo={pack.brand.assets.logo ?? null} copy={pack.shop.copy} inside={inside} products={products}
      previews={pack.shop.previews} gallery={gallery} fromPrice={formatPrice(pack.shop, pack.shop.products[cheapest].price)} messenger={env.messenger} open={state.open} testMode={state.open && state.testMode} cancelled={(await searchParams).cancelled === "1"}
    />
  );
}
