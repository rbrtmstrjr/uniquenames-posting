"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Loader2, MessageCircle } from "lucide-react";
import type { PackShop } from "@/packs/types";

// The thanks page (/shop/thanks?o=<token>): asks the server about the order every few seconds until PayMongo has
// confirmed the payment (the redirect from PayMongo alone proves nothing), then shows the Download button and the
// PDF password. Every ~15 s it asks the server to check with PayMongo itself, in case the webhook is late.

export interface ThanksView {
  status: "pending" | "paid" | "failed" | "expired";
  productName: string;
  password: string | null;
  email: string;
  emailed: boolean;
  downloads: number;
  maxDownloads: number;
  expiresAt: string | null;
}

export const POLL_MS = 3000;
export const CHECK_EVERY = 5; // every 5th poll asks PayMongo (~15 s)
export const SLOW_AFTER_MS = 3 * 60_000;
export const STOP_AFTER_MS = 30 * 60_000;

export function ThanksStatus({ token, initial, copy, messenger, supportLine }: {
  token: string; initial: ThanksView; copy: PackShop["copy"]["thanks"]; messenger: string | null; supportLine: string;
}) {
  const [view, setView] = useState<ThanksView>(initial);
  const [slow, setSlow] = useState(false);
  const [copied, setCopied] = useState(false);
  const started = useRef(0);

  useEffect(() => {
    if (view.status !== "pending") return;
    if (!started.current) started.current = Date.now();
    let polls = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      polls += 1;
      const waited = Date.now() - started.current;
      if (waited > SLOW_AFTER_MS) setSlow(true);
      try {
        const res = await fetch(`/api/shop/status?o=${token}${polls % CHECK_EVERY === 0 ? "&check=1" : ""}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as ThanksView;
          if (!stopped) setView(next);
          if (next.status !== "pending") return;
        }
      } catch { /* offline for a moment: try again */ }
      if (!stopped && waited < STOP_AFTER_MS) timer = setTimeout(tick, waited > SLOW_AFTER_MS ? POLL_MS * 3 : POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [token, view.status]);

  const copyPassword = async () => {
    if (!view.password) return;
    try { await navigator.clipboard.writeText(view.password); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select it by hand */ }
  };

  const help = messenger ? (
    <a href={messenger} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 font-semibold text-accent underline-offset-4 hover:underline">
      <MessageCircle className="size-4" aria-hidden /> {supportLine}
    </a>
  ) : null;

  if (view.status === "paid" && view.password) {
    const left = Math.max(0, view.maxDownloads - view.downloads);
    return (
      <div className="space-y-5" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-accent text-accent-ink"><Check className="size-6" strokeWidth={3} aria-hidden /></span>
          <h1 className="font-display text-3xl text-ink">{copy.paidTitle}</h1>
        </div>
        <p className="text-muted">{copy.paidText}</p>
        <div className="rounded-2xl bg-accent-soft p-4 text-center">
          <p className="text-xs font-bold uppercase tracking-[.14em] text-muted">{copy.passwordLabel}</p>
          <p className="mt-1 select-all font-mono text-2xl font-bold tracking-wide text-ink" data-testid="pdf-password">{view.password}</p>
          <button type="button" onClick={() => void copyPassword()}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-surface px-4 text-sm font-semibold text-ink shadow-soft transition active:scale-[.98]">
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy password"}
          </button>
        </div>
        {left > 0 ? (
          <form method="post" action={`/shop/download/${token}`}>
            <button type="submit" className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-base font-bold text-accent-ink shadow-soft transition hover:opacity-90 active:scale-[.99]">
              <Download className="size-5" aria-hidden /> {copy.downloadButton} · {view.productName}
            </button>
          </form>
        ) : (
          <p className="rounded-xl bg-bad/10 px-4 py-3 text-sm font-semibold text-bad">All {view.maxDownloads} downloads are used. Message us and we will help you.</p>
        )}
        <p className="text-sm text-muted">{copy.linkNote}{view.downloads > 0 ? ` ${left} left.` : ""}</p>
        {view.emailed && <p className="text-sm text-muted">{copy.emailedText.replace("{email}", view.email)}</p>}
        {help && <p className="text-sm">{help}</p>}
      </div>
    );
  }

  if (view.status === "pending") {
    return (
      <div className="space-y-4" aria-live="polite" role="status">
        <Loader2 className="size-10 animate-spin text-accent" aria-hidden />
        <h1 className="font-display text-3xl text-ink">{copy.waitingTitle}</h1>
        <p className="text-muted">{slow ? copy.slowText : copy.waitingText}</p>
        {slow && help && <p className="text-sm">{help}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl text-ink">{copy.expiredTitle}</h1>
      <p className="text-muted">{copy.expiredText}</p>
      <a href="/shop" className="inline-flex min-h-12 items-center rounded-2xl bg-accent px-5 font-bold text-accent-ink">Back to the shop</a>
      {help && <p className="text-sm">{help}</p>}
    </div>
  );
}
