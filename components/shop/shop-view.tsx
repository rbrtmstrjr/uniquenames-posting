import type { CSSProperties } from "react";
import { ArrowRight, BookHeart, ChevronDown, Download, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import type { PackShop } from "@/packs/types";
import { OrderForm, type ShopProductOption } from "./order-form";
import { ShopGallery, type ShopGalleryImage } from "./shop-gallery";
import { StickyOrderBar } from "./sticky-order-bar";

// The public shop page (/shop), mobile first (buyers come from Facebook on their phones). Top to bottom: the hero card
// (title, the order button, the PDF's cover + a sample page, trust badges), what's inside, the editions + the order
// form, the FAQ and the help link; behind it all, the pack's slow photo wall (ShopGallery). Every text sits on a
// near-opaque card (.shop-card), so the photos never touch its contrast. Each block is its own small component: add a
// section by writing one more and placing it in ShopView. Plain props only (server component; the form and the
// phone's order bar are the only client parts).

export interface ShopViewProps {
  brandName: string;
  logo: string | null;
  copy: PackShop["copy"];
  inside: string[];
  products: ShopProductOption[];
  previews: PackShop["previews"];
  /** The photo wall behind the page (full public URLs); empty or missing = a plain background. */
  gallery?: readonly ShopGalleryImage[];
  /** The cheapest edition's price ("₱50"), shown as "from ₱50" next to the order buttons. */
  fromPrice?: string | null;
  messenger: string | null;
  open: boolean;
  /** Test keys: only the signed-in owner sees the shop; payments are not real. */
  testMode?: boolean;
  cancelled: boolean;
}

const CARD = "shop-card rounded-[1.75rem] p-5 sm:p-7";
/** The entrance delay of a block below the hero (.shop-rise). */
const rise = (ms: number) => ({ "--rise-delay": `${ms}ms` }) as CSSProperties;

export function ShopShell({ brandName, logo, gallery, headerAction, children }: {
  brandName: string; logo: string | null; gallery?: readonly ShopGalleryImage[]; headerAction?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="relative isolate min-h-dvh overflow-x-clip bg-bg text-ink">
      {gallery?.length ? <ShopGallery images={gallery} /> : null}
      <header className="mx-auto max-w-5xl px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="shop-card flex min-h-14 items-center gap-2.5 rounded-2xl px-3 py-2 sm:px-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a tiny static SVG from public/ */}
          {logo ? <img src={logo} alt="" width={32} height={32} className="size-8 rounded-lg" /> : <BookHeart className="size-6 text-accent" aria-hidden />}
          <span className="font-display text-lg text-ink">{brandName}</span>
          {headerAction ? <span className="ml-auto">{headerAction}</span> : null}
        </div>
      </header>
      {/* with photos, phones get a window onto the wall between the header and the hero */}
      <main className={`mx-auto max-w-5xl px-4 pb-28 sm:px-6 md:pb-16 ${gallery?.length ? "pt-24 sm:pt-12 md:pt-6" : "pt-5"}`}>{children}</main>
    </div>
  );
}

const TRUST_ICONS = [ShieldCheck, Sparkles, Download, MessageCircle];

export function ShopView(p: ShopViewProps) {
  const c = p.copy;
  const from = p.fromPrice ? `from ${p.fromPrice}` : undefined;
  return (
    <ShopShell brandName={p.brandName} logo={p.logo} gallery={p.gallery}
      headerAction={p.open ? (
        <a href="#order" className="hidden min-h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-bold text-accent-ink shadow-soft transition hover:-translate-y-px hover:shadow-md active:translate-y-0 md:inline-flex">
          {c.formHeading} <ArrowRight className="size-4" aria-hidden />
        </a>
      ) : null}>
      {p.testMode && (
        <p role="status" className="shop-card mb-5 rounded-2xl border-warn px-4 py-3 text-sm font-semibold text-warn-text">
          Test mode — only you can see this. Payments here are not real (PayMongo test keys). Buyers see “Coming soon”.
        </p>
      )}
      <ShopHero {...p} from={from} />

      {p.cancelled && p.open && (
        <p role="status" className="shop-card mt-5 rounded-2xl px-4 py-3 text-sm text-ink">
          Your payment was not finished. You can try again below; nothing was charged.
        </p>
      )}

      <div className="mt-5 grid items-start gap-5 md:mt-6 md:grid-cols-[1fr_1.15fr] md:gap-6">
        <ShopInside heading={c.insideHeading} lines={p.inside} personalUse={c.personalUse} />
        <section id="order" aria-label={p.open ? undefined : c.comingSoon.title} style={rise(120)} className={`${CARD} shop-rise scroll-mt-4`}>
          {p.open ? (
            <OrderForm products={p.products} heading={c.formHeading} payButton={c.payButton} />
          ) : (
            <div className="py-6 text-center">
              <h2 className="font-display text-2xl text-ink">{c.comingSoon.title}</h2>
              <p className="mt-2 text-muted">{c.comingSoon.text}</p>
            </div>
          )}
        </section>
      </div>

      <ShopFaq heading={c.faqHeading} faq={c.faq} />
      <SupportLine text={c.supportLine} messenger={p.messenger} />
      {p.open && <StickyOrderBar label={c.formHeading} note={from} />}
    </ShopShell>
  );
}

function ShopHero(p: ShopViewProps & { from?: string }) {
  const c = p.copy;
  return (
    <section aria-labelledby="shop-title" className={`${CARD} shop-rise-still sm:p-8 md:p-10`}>
      <div className="grid items-center gap-7 md:grid-cols-[1.1fr_1fr] md:gap-10">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-accent">{c.eyebrow}</p>
          <h1 id="shop-title" className="mt-2 text-balance font-display text-4xl leading-[1.08] text-ink sm:text-5xl">{c.title}</h1>
          <p className="mt-3 max-w-prose text-pretty text-base leading-relaxed text-muted sm:text-lg">{c.subtitle}</p>
          {p.open && (
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
              <a id="hero-cta" href="#order"
                className="group inline-flex min-h-12 items-center gap-2 rounded-2xl bg-accent px-6 font-bold text-accent-ink shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:scale-[.98]">
                {c.formHeading}
                <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
              </a>
              {p.from && <span className="text-sm font-semibold text-muted">{p.from}</span>}
            </div>
          )}
        </div>
        {p.previews && (
          <figure className="relative mx-auto w-full max-w-sm">
            <div aria-hidden className="absolute inset-x-8 bottom-6 top-10 rounded-full bg-accent-soft blur-2xl" />
            <div className="relative aspect-[20/19]">
              {/* eslint-disable-next-line @next/next/no-img-element -- small static WebP previews from public/ (images are unoptimized here) */}
              <img src={p.previews.page} alt="A sample page of names with their meanings" width={640} height={905}
                className="absolute right-2 top-6 w-[60%] rotate-[4deg] rounded-lg border border-line shadow-lg" />
              {/* eslint-disable-next-line @next/next/no-img-element -- as above; the cover is the page's main picture */}
              <img src={p.previews.cover} alt={`The cover of ${c.eyebrow}`} width={640} height={905} fetchPriority="high"
                className="absolute left-2 top-0 w-[64%] -rotate-[3deg] rounded-lg border border-line shadow-xl" />
            </div>
            <figcaption className="relative mt-1 text-center text-xs text-muted">Sample pages. Your copy shows your own name.</figcaption>
          </figure>
        )}
      </div>
      <ul aria-label="Safe and simple" className="mt-7 grid grid-cols-1 gap-2 border-t border-line pt-5 min-[420px]:grid-cols-2 lg:grid-cols-4">
        {c.trust.map((t, i) => {
          const Icon = TRUST_ICONS[i % TRUST_ICONS.length];
          return (
            <li key={t} className="flex min-h-12 items-center gap-2.5 rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold leading-snug text-ink">
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg bg-bg"><Icon className="size-4 text-accent" /></span>
              {t}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ShopInside({ heading, lines, personalUse }: { heading: string; lines: string[]; personalUse: string }) {
  return (
    <section aria-labelledby="inside-heading" style={rise(60)} className={`${CARD} shop-rise md:sticky md:top-6`}>
      <h2 id="inside-heading" className="font-display text-2xl text-ink">{heading}</h2>
      <ul className="mt-4 space-y-3">
        {lines.map((line, i) => (
          <li key={line} className="flex gap-3 text-[15px] leading-relaxed text-ink">
            <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">{i + 1}</span>
            {line}
          </li>
        ))}
      </ul>
      <p className="mt-5 rounded-xl border border-dashed border-line px-3.5 py-3 text-xs leading-relaxed text-muted">{personalUse}</p>
    </section>
  );
}

function ShopFaq({ heading, faq }: { heading: string; faq: PackShop["copy"]["faq"] }) {
  return (
    <section aria-labelledby="faq-heading" style={rise(160)} className={`${CARD} shop-rise mt-5 md:mt-6`}>
      <h2 id="faq-heading" className="font-display text-2xl text-ink">{heading}</h2>
      <div className="mt-2 divide-y divide-line">
        {faq.map((f) => (
          <details key={f.q} className="group">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold text-ink transition-colors hover:text-accent [&::-webkit-details-marker]:hidden">
              {f.q}
              <ChevronDown className="size-4 shrink-0 text-muted transition duration-200 group-open:rotate-180" aria-hidden />
            </summary>
            <p className="pb-4 pr-6 text-[15px] leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function SupportLine({ text, messenger }: { text: string; messenger: string | null }) {
  if (!messenger) return null;
  return (
    <p className="mt-6 flex justify-center">
      <a href={messenger} target="_blank" rel="noopener noreferrer"
        className="shop-card inline-flex min-h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold text-accent underline-offset-4 transition hover:underline">
        <MessageCircle className="size-4" aria-hidden /> {text}
      </a>
    </p>
  );
}
