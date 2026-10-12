"use client";
import { useEffect, useState } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Phones only: a bar at the bottom with the order button, shown once the hero's button has scrolled away and hidden
// again while the order form is on screen (it would cover the pay button). Without IntersectionObserver (or before
// hydration) it simply stays hidden; the hero button is always there.

export function StickyOrderBar({ label, note, heroId = "hero-cta", targetId = "order" }: { label: string; note?: string; heroId?: string; targetId?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const hero = document.getElementById(heroId);
    const target = document.getElementById(targetId);
    if (!hero || !target || typeof IntersectionObserver === "undefined") return;
    const seen = new Map<Element, boolean>();
    const update = (entries: IntersectionObserverEntry[]) => {
      for (const e of entries) seen.set(e.target, e.isIntersecting);
      setShow(!seen.get(hero) && !seen.get(target));
    };
    const heroIo = new IntersectionObserver(update);
    // the form counts as "on screen" once it reaches the upper 60% of the screen (just peeking in at the bottom: keep the bar)
    const formIo = new IntersectionObserver(update, { rootMargin: "0px 0px -40% 0px" });
    heroIo.observe(hero);
    formIo.observe(target);
    return () => { heroIo.disconnect(); formIo.disconnect(); };
  }, [heroId, targetId]);

  return (
    <div data-testid="sticky-order-bar" data-show={show || undefined} aria-hidden={!show} inert={!show}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3 transition duration-300 ease-out md:hidden",
        "border-t border-line bg-bg/95 shadow-[0_-8px_24px_rgba(60,35,15,.08)] backdrop-blur-md",
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0",
      )}>
      <a href={`#${targetId}`} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-base font-bold text-accent-ink shadow-soft transition active:scale-[.98]">
        {label}{note ? <span className="font-semibold">· {note}</span> : null}
        <ArrowDown className="size-4" aria-hidden />
      </a>
    </div>
  );
}
