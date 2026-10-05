import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge only knows Tailwind's built-in animations; teach it ours (globals.css @theme)
// so e.g. our `animate-shimmer` replaces shadcn's `animate-pulse` instead of both staying.
const twMerge = extendTailwindMerge({ extend: { theme: { animate: ["shimmer", "pop"] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
