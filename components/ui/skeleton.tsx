import { cn } from "@/lib/utils/cn";
import { Skeleton as ShadcnSkeleton } from "@/components/ui/shadcn/skeleton";

// shadcn Skeleton with our warm shimmer instead of its pulse.
export function Skeleton({ className }: { className?: string }) {
  return <ShadcnSkeleton aria-hidden className={cn("shimmer animate-shimmer rounded-xl", className)} />;
}
