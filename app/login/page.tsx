import type { CSSProperties } from "react";
import { LoginForm } from "./login-form";
import { safeNext } from "@/lib/supabase/proxy";
import { brand } from "@/packs/shared";

/** The pack's login photos and colours as the CSS variables .studio-backdrop reads (app/globals.css). */
function backdropVars(): CSSProperties {
  const { login, loginColor } = brand().assets;
  return {
    "--login-light-wide": `url("${login.lightWide}")`, "--login-light-tall": `url("${login.lightTall}")`,
    "--login-dark-wide": `url("${login.darkWide}")`, "--login-dark-tall": `url("${login.darkTall}")`,
    "--login-light-color": loginColor.light, "--login-dark-color": loginColor.dark,
  } as CSSProperties;
}

// The background is a real (AI-made, text-free) empty photoshoot set from the active pack: the props sit at the
// sides on wide screens and low in the corners on phones, so the card always lands on bare backdrop.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; denied?: string }> }) {
  const { next, denied } = await searchParams;
  const b = brand();
  return (
    <main className="studio-backdrop relative flex min-h-dvh flex-col items-center justify-start px-5 pt-[7dvh] pb-6 md:justify-center md:py-10" style={backdropVars()}>
      <div className="studio-vignette pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative w-full max-w-sm animate-pop">
        <div className="rounded-[28px] border border-white/50 bg-surface/80 p-6 shadow-[0_24px_60px_-20px_rgba(60,35,15,.45)] backdrop-blur-xl sm:p-7 dark:border-white/10 dark:bg-surface/75">
          <div className="mb-6 text-center">
            {b.assets.logo
              // eslint-disable-next-line @next/next/no-img-element -- a tiny static SVG from public/
              ? <img src={b.assets.logo} alt="" aria-hidden className="mx-auto h-16 w-auto" />
              : <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent-soft font-display text-2xl italic text-accent" aria-hidden>{b.mark}</div>}
            <h1 className="mt-3 font-display text-3xl text-ink">{b.name}</h1>
            <p className="mt-1 text-sm text-muted">{b.loginTagline}</p>
          </div>
          <LoginForm next={safeNext(next)} denied={denied === "1"} />
        </div>
        <p className="mt-4 text-center text-xs font-semibold text-ink/75 dark:text-white/75">{b.loginFooter}</p>
      </div>
    </main>
  );
}
