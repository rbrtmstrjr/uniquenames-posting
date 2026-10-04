import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="aspect-square" />)}
      </div>
    </div>
  );
}
