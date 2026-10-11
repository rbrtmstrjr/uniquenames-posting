"use client";
import { useState } from "react";
import { Check, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// The shop's order form (/shop): pick an edition, type a name and an email (+ an optional Facebook name), then go to
// PayMongo. Sends a product id only; the server looks up the price. `website` is a honeypot people never see.

export interface ShopProductOption { id: "girl" | "boy" | "both"; name: string; price: string; blurb: string; badge?: string; count: number | null }

type Field = "product" | "buyerName" | "email" | "fbName" | "spam";

export function OrderForm({ products, heading, payButton, initial = "both" }: {
  products: ShopProductOption[]; heading: string; payButton: string; initial?: ShopProductOption["id"];
}) {
  const [product, setProduct] = useState<ShopProductOption["id"]>(initial);
  const [buyerName, setBuyerName] = useState("");
  const [email, setEmail] = useState("");
  const [fbName, setFbName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: Field } | null>(null);
  const chosen = products.find((p) => p.id === product);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/shop/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, buyerName, email, fbName, website }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string; field?: Field };
      if (res.ok && body.url && /^https:\/\//.test(body.url)) {
        window.location.assign(body.url);
        return; // keep the button busy while the browser leaves
      }
      setError({ text: body.error ?? "Something went wrong. Please try again.", field: body.field });
    } catch {
      setError({ text: "Could not connect. Check your internet and try again." });
    }
    setBusy(false);
  };

  const input = "min-h-12 w-full rounded-xl border border-line bg-surface px-4 text-base text-ink outline-none transition placeholder:text-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";
  const bad = (f: Field) => error?.field === f;

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-labelledby="order-heading">
      <h2 id="order-heading" className="font-display text-2xl text-ink">{heading}</h2>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Choose your edition</legend>
        <div className="grid gap-2" role="radiogroup">
          {products.map((p) => {
            const on = p.id === product;
            return (
              <label key={p.id} className={cn(
                "relative flex cursor-pointer items-center gap-3 rounded-2xl border bg-surface p-4 transition",
                on ? "border-accent ring-2 ring-accent/25" : "border-line hover:border-accent/50",
              )}>
                <input type="radio" name="product" value={p.id} checked={on} onChange={() => setProduct(p.id)} className="sr-only" />
                <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2", on ? "border-accent bg-accent text-accent-ink" : "border-line")}>
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{p.name}</span>
                    {p.badge && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">{p.badge}</span>}
                  </span>
                  <span className="block text-sm text-muted">{p.blurb}{p.count ? ` ${p.count.toLocaleString("en-US")} names.` : ""}</span>
                </span>
                <span className="text-lg font-bold text-ink">{p.price}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="buyerName" className="text-sm font-semibold text-ink">Your name</label>
        <input id="buyerName" name="buyerName" autoComplete="name" required maxLength={80} value={buyerName} onChange={(e) => setBuyerName(e.target.value)}
          aria-invalid={bad("buyerName") || undefined} className={input} placeholder="e.g. Maria Santos" />
        <p className="text-xs text-muted">Printed on your PDF.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-semibold text-ink">Email</label>
        <input id="email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)}
          aria-invalid={bad("email") || undefined} className={input} placeholder="you@gmail.com" />
        <p className="text-xs text-muted">We send your download link and password here.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="fbName" className="text-sm font-semibold text-ink">Facebook name <span className="font-normal text-muted">(optional)</span></label>
        <input id="fbName" name="fbName" autoComplete="nickname" maxLength={80} value={fbName} onChange={(e) => setFbName(e.target.value)}
          aria-invalid={bad("fbName") || undefined} className={input} placeholder="So we can find you if you message us" />
      </div>
      {/* honeypot: hidden from people and screen readers; bots fill it in */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <div aria-live="polite" role="status" className="min-h-0">
        {error && <p className="rounded-xl bg-bad/10 px-4 py-3 text-sm font-semibold text-bad">{error.text}</p>}
      </div>

      <button type="submit" disabled={busy} aria-busy={busy || undefined}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-base font-bold text-accent-ink shadow-soft transition hover:opacity-90 active:scale-[.99] disabled:opacity-60">
        {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
        {payButton}{chosen ? ` · ${chosen.price}` : ""}
      </button>
    </form>
  );
}
