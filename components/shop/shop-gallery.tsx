import type { CSSProperties } from "react";
import type { ShopGallery as ShopGalleryConfig } from "@/packs/types";

// The slow photo wall behind /shop: the page's own photoshoot photos in 3 (phones) / 4 (tablets) / 5 (desktop)
// columns that drift up and down, under a cream veil (app/globals.css .shop-gallery*). Purely decorative: hidden from
// screen readers, no JavaScript, CSS transforms only (GPU), low-priority lazy images that never compete with the
// hero. prefers-reduced-motion: the wall stands still. Text never sits on it: every block of the page is a card.

export interface ShopGalleryImage { src: string; width: number; height: number }

/** Columns on the widest screens (CSS hides the 4th below `sm` and the 5th below `lg`). */
export const GALLERY_COLUMNS = 5;
/** Each column repeats its photos to at least this many tiles, so one set is taller than any screen. */
export const MIN_TILES = 8;
/** Seconds per loop, per column (60-120 s: slow enough to stay in the background). */
const DRIFT_SECONDS = [96, 118, 84, 108, 90];

const DIR_RE = /^\/[a-z0-9][a-z0-9/_-]*$/;
const FILE_RE = /^[a-z0-9][a-z0-9_.-]*\.(webp|avif|jpe?g|png)$/i;

/** The pack's gallery as image URLs (dir + file). Only plain public paths pass; none or no images = no gallery. */
export function galleryImages(g: ShopGalleryConfig | null | undefined): ShopGalleryImage[] {
  if (!g || !DIR_RE.test(g.dir)) return [];
  return g.images
    .filter((i) => FILE_RE.test(i.src) && i.width > 0 && i.height > 0)
    .map((i) => ({ src: `${g.dir.replace(/\/+$/, "")}/${i.src}`, width: i.width, height: i.height }));
}

/** Deals the photos into columns (round robin, so neighbours differ) and repeats short columns up to MIN_TILES. */
export function galleryColumns<T>(images: readonly T[], columns = GALLERY_COLUMNS, minTiles = MIN_TILES): T[][] {
  if (!images.length) return [];
  const cols: T[][] = Array.from({ length: columns }, () => []);
  images.forEach((img, i) => cols[i % columns].push(img));
  return cols.map((col, c) => {
    const base = col.length ? col : [images[c % images.length]];
    const out = [...base];
    // continue from a shifted start, so a repeat does not sit right under the same photo
    for (let i = 0; out.length < minTiles; i++) out.push(base[(i + 1) % base.length]);
    return out;
  });
}

export function ShopGallery({ images }: { images: readonly ShopGalleryImage[] }) {
  const cols = galleryColumns(images);
  if (!cols.length) return null;
  return (
    <div aria-hidden="true" data-testid="shop-gallery" className="shop-gallery">
      <div className="shop-gallery-grid">
        {cols.map((col, c) => (
          <div key={c} className="shop-gallery-col" data-col={c} style={{ "--drift": `${DRIFT_SECONDS[c % DRIFT_SECONDS.length]}s` } as CSSProperties}>
            {/* the set twice: the strip moves by exactly one set (-50%) and starts over without a jump */}
            <div className={c % 2 ? "shop-drift shop-drift-down" : "shop-drift shop-drift-up"}>
              {[...col, ...col].map((img, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- tiny static WebP tiles from public/, decorative
                <img key={i} src={img.src} alt="" width={img.width} height={img.height} loading="lazy" decoding="async"
                  fetchPriority="low" draggable={false} className="shop-tile" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="shop-veil" />
    </div>
  );
}
