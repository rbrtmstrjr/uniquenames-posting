import { cn } from "@/lib/utils/cn";
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("shimmer animate-shimmer rounded-xl", className)} />;
}
