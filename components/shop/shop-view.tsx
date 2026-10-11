import { BookHeart, ChevronDown, Download, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import type { PackShop } from "@/packs/types";
import { OrderForm, type ShopProductOption } from "./order-form";

// The public shop page (/shop): hero with the PDF's cover and a sample names page, what's inside, the order form,
// trust notes, FAQ and the help link. Mobile first (buyers come from Facebook on their phones). Plain props only.

export interface ShopViewProps {
  brandName: string;
  logo: string | null;
  copy: PackShop["copy"];
  inside: string[];
  products: ShopProductOption[];
  previews: PackShop["previews"];
  messenger: string | null;
  open: boolean;
  cancelled: boolean;
}

export function ShopShell({ brandName, logo, children }: { brandName: string; logo: string | null; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh overflow-x-clip bg-bg text-ink">
      <header className="mx-auto flex max-w-5xl items-center gap-2 px-4 pt-5 sm:px-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- a tiny static SVG from public/ */}
        {logo ? <img src={logo} alt="" className="size-8 rounded-lg" /> : <BookHeart className="size-6 text-accent" aria-hidden />}
        <span className="font-display text-lg text-ink">{brandName}</span>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6">{children}</main>
    </div>
  );
}

const TRUST_ICONS = [ShieldCheck, Sparkles, Download, MessageCircle];

export function ShopView(p: ShopViewProps) {
  const c = p.copy;
  return (
    <ShopShell brandName={p.brandName} logo={p.logo}>
      <section className="grid items-center gap-8 md:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-accent">{c.eyebrow}</p>
          <h1 className="mt-2 font-display text-4xl leading-tight text-ink sm:text-5xl">{c.title}</h1>
          <p className="mt-3 text-base leading-relaxed text-muted sm:text-lg">{c.subtitle}</p>
          {p.open && (
            <a href="#order" className="mt-5 inline-flex min-h-12 items-center rounded-2xl bg-accent px-5 font-bold text-accent-ink shadow-soft transition hover:opacity-90 md:hidden">
              {c.formHeading}
            </a>
          )}
        </div>
        {p.previews && (
          <figure className="relative mx-auto w-full max-w-sm">
            <div className="relative aspect-[20/19]">
              {/* eslint-disable-next-line @next/next/no-img-element -- small static WebP previews from public/ (images are unoptimized here) */}
              <img src={p.previews.page} alt="A sample page of names with their meanings" width={640} height={905}
                className="absolute right-2 top-6 w-[60%] rotate-[4deg] rounded-lg border border-line shadow-lg" />
              {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
              <img src={p.previews.cover} alt={`The cover of ${c.eyebrow}`} width={640} height={905}
                className="absolute left-2 top-0 w-[64%] -rotate-[3deg] rounded-lg border border-line shadow-xl" />
            </div>
            <figcaption className="mt-1 text-center text-xs text-muted">Sample pages. Your copy shows your own name.</figcaption>
          </figure>
        )}
      </section>

      {p.cancelled && p.open && (
        <p role="status" className="mt-6 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink">
          Your payment was not finished. You can try again below; nothing was charged.
        </p>
      )}

      <div className="mt-10 grid gap-8 md:grid-cols-[1fr_1fr]">
        <section aria-labelledby="inside-heading" className="rounded-3xl border border-line bg-surface p-5 shadow-soft sm:p-6">
          <h2 id="inside-heading" className="font-display text-2xl text-ink">{c.insideHeading}</h2>
          <ul className="mt-3 space-y-2.5">
            {p.inside.map((line) => (
              <li key={line} className="flex gap-2.5 text-[15px] leading-relaxed text-ink">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" /> {line}
              </li>
            ))}
          </ul>
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {c.trust.map((t, i) => {
              const Icon = TRUST_ICONS[i % TRUST_ICONS.length];
              return (
                <li key={t} className="flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-ink">
                  <Icon className="size-4 shrink-0 text-accent" aria-hidden /> {t}
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-muted">{c.personalUse}</p>
        </section>

        <section id="order" className="scroll-mt-6 rounded-3xl border border-line bg-surface p-5 shadow-soft sm:p-6">
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

      <section aria-labelledby="faq-heading" className="mt-10">
        <h2 id="faq-heading" className="font-display text-2xl text-ink">{c.faqHeading}</h2>
        <div className="mt-3 divide-y divide-line rounded-3xl border border-line bg-surface">
          {c.faq.map((f) => (
            <details key={f.q} className="group px-5 py-1">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDown className="size-4 shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
              </summary>
              <p className="pb-4 text-[15px] leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <SupportLine text={c.supportLine} messenger={p.messenger} />
    </ShopShell>
  );
}

export function SupportLine({ text, messenger }: { text: string; messenger: string | null }) {
  if (!messenger) return null;
  return (
    <p className="mt-8 text-center text-sm text-muted">
      <a href={messenger} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 font-semibold text-accent underline-offset-4 hover:underline">
        <MessageCircle className="size-4" aria-hidden /> {text}
      </a>
    </p>
  );
}
