import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";

// Route skeletons (rendered by each loading.tsx). They mirror the real page layouts, so a
// tap on a tab or a post shows the page's structure at once while the server answers.

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function Frame({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={`Loading ${label}`} data-testid="page-skeleton" className={className}>
      <span className="sr-only">Loading {label}…</span>
      {children}
    </div>
  );
}

function HeaderSkeleton({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="mb-5 space-y-2">
      <Skeleton className="h-8 w-40 sm:h-9" />
      {subtitle && <Skeleton className="h-4 w-full max-w-md" />}
    </div>
  );
}

function PanelSkeleton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface p-4 shadow-soft sm:p-5", className)}>
      <Skeleton className="mb-4 h-3 w-24 rounded-md" />
      {children}
    </div>
  );
}

function TileGrid({ count, className }: { count: number; className: string }) {
  return <div className={cn("grid", className)}>{range(count).map((i) => <Skeleton key={i} className="aspect-square" />)}</div>;
}

export function TodaySkeleton() {
  return (
    <Frame label="Today">
      <HeaderSkeleton />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_440px] 2xl:grid-cols-2">
        {/* New post: title + date, Who (3 fields), Look (theme, details tile, fonts row), Cards, footer. */}
        <div className="space-y-6 rounded-2xl border border-line bg-surface p-4 shadow-soft sm:p-5">
          <div className="flex items-center justify-between gap-3"><Skeleton className="h-7 w-28 rounded-md" /><Skeleton className="h-11 w-40" /></div>
          <div>
            <Skeleton className="mb-3 h-3 w-10 rounded-md" />
            <div className="grid grid-cols-[2fr_3fr] gap-4 sm:grid-cols-3">
              {range(3).map((i) => <div key={i} className={cn("space-y-2", i === 2 && "col-span-2 sm:col-span-1")}><Skeleton className="h-4 w-20 rounded-md" /><Skeleton className="h-11" /></div>)}
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="mb-3 h-3 w-10 rounded-md" />
            <div className="flex justify-between"><Skeleton className="h-4 w-14 rounded-md" /><Skeleton className="h-4 w-36 rounded-md" /></div>
            <Skeleton className="h-11" />
            <Skeleton className="h-[5.5rem]" />
            <Skeleton className="!mt-4 h-11" />
          </div>
          <div><Skeleton className="mb-3 h-3 w-12 rounded-md" /><Skeleton className="h-11" /></div>
          <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1.5"><Skeleton className="h-4 w-72 max-w-full rounded-md" /><Skeleton className="h-3 w-24 rounded-md" /></div>
            <Skeleton className="h-12 w-full sm:w-44" />
          </div>
        </div>
        {/* Right column: Stock left (2×2 table, themes left, two links), then the post being made. */}
        <div className="min-w-0 space-y-4">
        <PanelSkeleton>
          <div className="grid grid-cols-[5.25rem_1fr_1fr] gap-1">
            <span /><Skeleton className="mx-2 h-3 w-8 rounded-md" /><Skeleton className="mx-2 h-3 w-8 rounded-md" />
            {range(2).map((r) => [<Skeleton key={`l${r}`} className="my-auto h-4 w-16 rounded-md" />, <Skeleton key={`a${r}`} className="h-16" />, <Skeleton key={`b${r}`} className="h-16" />])}
          </div>
          <div className="mt-4 space-y-2 border-t border-line pt-4">
            <Skeleton className="h-3 w-20 rounded-md" />
            <div className="grid grid-cols-2 gap-2"><Skeleton className="h-11" /><Skeleton className="h-11" /></div>
          </div>
        </PanelSkeleton>
        <PanelSkeleton>
          <Skeleton className="mb-4 h-2.5 w-full rounded-full" />
          <TileGrid count={9} className="grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 2xl:grid-cols-5" />
        </PanelSkeleton>
        </div>
      </div>
    </Frame>
  );
}

export function PostsSkeleton() {
  return (
    <Frame label="Posts">
      <HeaderSkeleton />
      <div className="space-y-4">
        <Skeleton className="h-[52px] w-72 max-w-full" />
        <ul className="grid gap-3 md:grid-cols-2">
          {range(6).map((i) => (
            <li key={i} className="rounded-2xl border border-line bg-surface p-3 shadow-soft">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1.5"><Skeleton className="h-5 w-36 rounded-md" /><Skeleton className="h-3 w-52 rounded-md" /></div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <TileGrid count={6} className="mt-3 grid-cols-6 gap-1.5" />
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

export function PostDetailSkeleton() {
  return (
    <Frame label="post" className="space-y-4">
      <Skeleton className="h-11 w-20" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2"><Skeleton className="h-8 w-56 sm:h-9" /><Skeleton className="h-4 w-48 rounded-md" /></div>
        <div className="flex items-center gap-2"><Skeleton className="h-6 w-16 rounded-full" /><Skeleton className="h-11 w-32" /></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <PanelSkeleton>
          <Skeleton className="mb-3 h-3 w-full max-w-sm rounded-md" />
          <TileGrid count={8} className="grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4" />
        </PanelSkeleton>
        <div className="space-y-4">
          <PanelSkeleton>
            <div className="space-y-4">
              <Skeleton className="h-11 w-48" />
              <Skeleton className="h-3 w-16 rounded-md" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-11 w-36" />
            </div>
          </PanelSkeleton>
          <Skeleton className="h-11 w-32" />
        </div>
      </div>
    </Frame>
  );
}

export function NamesSkeleton() {
  return (
    <Frame label="Names">
      <HeaderSkeleton />
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><Skeleton className="h-11 w-32" /><Skeleton className="h-11 w-32" /></div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-11 min-w-56 flex-1" />
          <Skeleton className="h-[52px] w-44" /><Skeleton className="h-[52px] w-56" /><Skeleton className="h-[52px] w-72 max-w-full" />
        </div>
        <Skeleton className="h-3 w-28 rounded-md" />
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {range(8).map((i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 basis-full space-y-1.5 sm:basis-0 sm:flex-1"><Skeleton className="h-4 w-32 rounded-md" /><Skeleton className="h-3.5 w-56 max-w-full rounded-md" /></div>
              <Skeleton className="h-6 w-24 rounded-full" /><Skeleton className="h-6 w-20 rounded-full" />
              <div className="ml-auto flex gap-1">{range(3).map((j) => <Skeleton key={j} className="size-11" />)}</div>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

export function ThemesSkeleton() {
  return (
    <Frame label="Themes">
      <HeaderSkeleton />
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><Skeleton className="h-[52px] w-60" /><Skeleton className="h-11 w-36" /></div>
        <section>
          <Skeleton className="mb-2 h-3 w-28 rounded-md" />
          <ul className="space-y-2">
            {range(5).map((i) => (
              <li key={i} className="flex gap-2 rounded-2xl border border-line bg-surface p-3 shadow-soft">
                <Skeleton className="h-11 w-11 shrink-0 self-start" />
                <Skeleton className="aspect-square w-24 shrink-0 self-start sm:w-28" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-5 w-40 rounded-md" />
                  <Skeleton className="h-3 w-full max-w-md rounded-md" />
                  <div className="flex flex-wrap gap-1 pt-1">{range(3).map((j) => <Skeleton key={j} className="h-11 w-24" />)}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Frame>
  );
}

export function SettingsSkeleton() {
  return (
    <Frame label="Settings">
      <HeaderSkeleton subtitle={false} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <PanelSkeleton><div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-11 w-full" /><Skeleton className="h-16 w-full" /></div></PanelSkeleton>
          <PanelSkeleton><div className="grid gap-3 sm:grid-cols-3">{range(3).map((i) => <Skeleton key={i} className="h-11" />)}</div></PanelSkeleton>
          <PanelSkeleton><div className="flex flex-wrap gap-3"><Skeleton className="h-11 w-56" /><Skeleton className="h-11 w-40" /><Skeleton className="h-11 w-24" /></div></PanelSkeleton>
          <div className="flex justify-between gap-2"><Skeleton className="h-11 w-36" /><Skeleton className="h-11 w-28" /></div>
        </div>
        <PanelSkeleton className="lg:self-start">
          <div className="space-y-2.5"><Skeleton className="h-8 w-40 rounded-full" />{range(4).map((i) => <Skeleton key={i} className="h-4 w-full rounded-md" />)}</div>
        </PanelSkeleton>
      </div>
    </Frame>
  );
}
