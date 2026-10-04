"use client";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";

// False on the server/hydration pass, true afterwards (avoids a theme mismatch).
const subscribe = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = !mounted ? Monitor : theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = !mounted ? "Theme" : theme === "light" ? "Light" : theme === "dark" ? "Dark" : "Auto";
  return (
    <button type="button" onClick={() => setTheme(next)} aria-label={`Theme: ${label}. Switch to ${next}`}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink">
      <Icon className="size-4" aria-hidden /> {label}
    </button>
  );
}
