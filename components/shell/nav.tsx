"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarHeart, Clapperboard, Images, Type, Palette, Settings } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Phones keep 5 tabs (the most a bottom bar holds comfortably): Themes moves off the bar and is
// reached from "More" (Settings shows a Themes link on phones) and from Today's "Manage themes".
export const NAV = [
  { href: "/", label: "Today", short: "Today", icon: CalendarHeart, phone: true },
  { href: "/posts", label: "Posts", short: "Posts", icon: Images, phone: true },
  { href: "/reels", label: "Reels", short: "Reels", icon: Clapperboard, phone: true },
  { href: "/names", label: "Names", short: "Names", icon: Type, phone: true },
  { href: "/themes", label: "Themes", short: "Themes", icon: Palette, phone: false },
  { href: "/settings", label: "Settings", short: "More", icon: Settings, phone: true },
];
export const PHONE_NAV = NAV.filter((n) => n.phone);

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));
/** Phone tabs: "More" also lights up on Themes (it lives under More on phones). */
const isPhoneActive = (path: string, href: string) => isActive(path, href) || (href === "/settings" && isActive(path, "/themes"));

// The tapped tab lights up at once (the URL only changes once the new page arrives);
// it hands back to the real path as soon as the navigation commits.
function useActivePath() {
  const path = usePathname();
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  if (pending && pending.from !== path) setPending(null);
  const onNavigate = (e: React.MouseEvent, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // opens elsewhere
    if (path !== href) setPending({ from: path, to: href });
  };
  return { path: pending?.to ?? path, onNavigate };
}

export function SideNav() {
  const { path, onNavigate } = useActivePath();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} onClick={(e) => onNavigate(e, href)} aria-current={isActive(path, href) ? "page" : undefined}
          className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition",
            isActive(path, href) ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2/60 hover:text-ink")}>
          <Icon className="size-[18px]" aria-hidden /> {label}
        </Link>
      ))}
    </nav>
  );
}

export function BottomTabs() {
  const { path, onNavigate } = useActivePath();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-5">
        {PHONE_NAV.map(({ href, short, icon: Icon }) => (
          <li key={href}>
            <Link href={href} onClick={(e) => onNavigate(e, href)} aria-current={isPhoneActive(path, href) ? "page" : undefined}
              className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
                isPhoneActive(path, href) ? "text-accent" : "text-muted")}>
              <Icon className="size-5" aria-hidden /> {short}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
