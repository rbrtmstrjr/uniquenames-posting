"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarHeart, Images, Type, Palette, Settings } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export const NAV = [
  { href: "/", label: "Today", short: "Today", icon: CalendarHeart },
  { href: "/posts", label: "Posts", short: "Posts", icon: Images },
  { href: "/names", label: "Names", short: "Names", icon: Type },
  { href: "/themes", label: "Themes", short: "Themes", icon: Palette },
  { href: "/settings", label: "Settings", short: "More", icon: Settings },
];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

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
        {NAV.map(({ href, short, icon: Icon }) => (
          <li key={href}>
            <Link href={href} onClick={(e) => onNavigate(e, href)} aria-current={isActive(path, href) ? "page" : undefined}
              className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
                isActive(path, href) ? "text-accent" : "text-muted")}>
              <Icon className="size-5" aria-hidden /> {short}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
