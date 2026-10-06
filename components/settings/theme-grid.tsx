"use client";
import { useCallback, useState } from "react";
import { Check, ImageIcon, Maximize2, RefreshCw, Smile, Wand2 } from "lucide-react";
import { toast } from "sonner";
import type { ReelThemeId, ReelThemeRow } from "@/lib/db/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FadeImage } from "@/components/ui/fade-image";
import { callAction } from "@/lib/actions/call";
import { queueAllThemePreviewsAction, queueThemePreviewAction } from "@/lib/actions/reel-themes";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeRows } from "@/lib/realtime/use-table";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import { byThemeOrder, needsPreview, PREVIEW_LABEL, previewBusy, previewPath, previewShown } from "@/lib/reels/themes";
import { cn } from "@/lib/utils/cn";

/**
 * Settings → Theme: the 8 visual themes as cards with their preview picture (made by the PC). Tap a card to make
 * it the default for new reels (saved with Save settings); tap a ready picture to see it large. Before migration
 * 007 (`themes` or `value` missing) it only explains the database update. The rows stay live (realtime), so a
 * preview appears the moment the PC saves it.
 */
export function ThemeGrid({ themes, value, onChange }: {
  themes: ReelThemeRow[] | null; value: ReelThemeId | null; onChange: (id: ReelThemeId) => void;
}) {
  if (!themes?.length || !value) {
    return (
      <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">
        Visual themes need the database update first (run <span className="font-semibold text-ink [overflow-wrap:anywhere]">supabase/migrations/007_reel_themes.sql</span>).
        Until then every reel uses the Knitted Doll look.
      </p>
    );
  }
  return <ThemeGridReady initial={themes} value={value} onChange={onChange} />;
}

function ThemeGridReady({ initial, value, onChange }: { initial: ReelThemeRow[]; value: ReelThemeId; onChange: (id: ReelThemeId) => void }) {
  const refetch = useCallback(async () => {
    const { data, error } = await createClient().from("reel_themes").select("*");
    return error ? null : ((data ?? []) as ReelThemeRow[]);
  }, []);
  const [themes, setThemes] = useRealtimeRows<ReelThemeRow>("reel_themes", initial, { key: "settings-themes", sort: byThemeOrder, refetch });
  const signed = useSignedUrls(themes.map(previewShown), "reels");
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<ReelThemeId | null>(null);

  const ready = themes.filter((t) => previewPath(t)).length;
  const making = themes.filter(previewBusy).length;
  const todo = themes.filter(needsPreview).length;
  const current = themes.find((t) => t.id === value);
  const open = themes.find((t) => t.id === openId) ?? null;
  // Shown as "in line" right away; realtime then brings the PC's progress.
  const markQueued = (ids: string[]) =>
    setThemes((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, preview_status: "queued", error: null } : t)));

  const makeOne = async (t: ReelThemeRow) => {
    setBusy(t.id);
    const r = await callAction(() => queueThemePreviewAction(t.id));
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    markQueued([t.id]);
    toast.success(`${t.label} preview in line. Your PC makes it when it's free.`);
  };
  const makeAll = async () => {
    setBusy("all");
    const ids = themes.filter(needsPreview).map((t) => t.id);
    const r = await callAction(() => queueAllThemePreviewsAction());
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    if (r.queued) markQueued(ids);
    toast.success(r.queued ? `${r.queued} preview${r.queued === 1 ? "" : "s"} in line. Your PC makes them when it's free.` : "Every theme already has a preview.");
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">Default theme{current ? <span className="font-normal text-muted"> · {current.emoji} {current.label}</span> : null}</h3>
          <p className="text-xs text-muted" data-testid="theme-summary">
            {ready} of {themes.length} previews ready{making ? ` · ${making} being made` : ""}. Each reel can use another theme on its review page.
          </p>
        </div>
        {todo > 0 && (
          <Button variant="subtle" size="sm" loading={busy === "all"} disabled={!!busy} onClick={() => void makeAll()}>
            {busy !== "all" && <Wand2 className="size-4" aria-hidden />} Make all previews ({todo})
          </Button>
        )}
      </div>

      <div role="radiogroup" aria-label="Default theme" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {themes.map((t) => {
          const selected = t.id === value;
          const path = previewShown(t);
          const url = path ? signed(path) : undefined;
          const status = PREVIEW_LABEL[t.preview_status];
          const waiting = previewBusy(t);
          const make = waiting ? status.label : path ? "Make again" : "Make preview";
          return (
            <div key={t.id} data-testid={`theme-${t.id}`}
              className={cn("flex flex-col overflow-hidden rounded-2xl border bg-surface transition-colors",
                selected ? "border-accent ring-2 ring-accent/40" : "border-line")}>
              {/* The picture: tap a ready one to see it large; before that, tapping it picks the theme. */}
              <button type="button" onClick={() => (path ? setOpenId(t.id) : onChange(t.id))}
                aria-label={path ? `See the ${t.label} preview` : `Use ${t.label} (no preview yet)`}
                className="group relative block aspect-[4/5] w-full overflow-hidden bg-surface-2 outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 sm:aspect-[9/16]">
                {path ? (
                  <>
                    <FadeImage src={url} alt="" className="object-[50%_35%]" />
                    <span aria-hidden className="absolute right-1.5 bottom-1.5 grid size-7 place-items-center rounded-full bg-black/45 text-white opacity-90 transition group-hover:opacity-100">
                      <Maximize2 className="size-3.5" />
                    </span>
                  </>
                ) : (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 text-center">
                    <span aria-hidden className={cn("text-4xl", waiting && "animate-pulse")}>{t.emoji}</span>
                    <Badge tone={status.tone} pulse={t.preview_status === "making"} className="whitespace-nowrap px-2 py-0.5 text-[11px]">{status.label}</Badge>
                    {t.preview_status === "failed" && t.error && <span className="line-clamp-2 text-[11px] text-bad" title={t.error}>{t.error}</span>}
                  </span>
                )}
                {path && waiting && (
                  <span className="absolute top-1.5 left-1.5"><Badge tone={status.tone} pulse={t.preview_status === "making"} className="whitespace-nowrap bg-surface/90 px-2 py-0.5 text-[11px]">{status.label}</Badge></span>
                )}
                {selected && (
                  <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-ink shadow-soft">
                    <Check className="size-3" aria-hidden /> Default
                  </span>
                )}
              </button>

              <button type="button" role="radio" aria-checked={selected} onClick={() => onChange(t.id)}
                className="flex min-h-11 flex-1 flex-col items-start gap-1 px-2.5 pt-2 pb-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
                <span className="flex w-full min-w-0 items-center gap-1.5">
                  <span aria-hidden className="shrink-0 text-base leading-none">{t.emoji}</span>
                  <span className="truncate text-sm font-semibold text-ink">{t.label}</span>
                </span>
                <span className="line-clamp-2 text-xs text-muted">{t.blurb}</span>
                {t.faces && (
                  <Badge tone="accent" className="mt-0.5 whitespace-nowrap px-1.5 py-0 text-[11px]"><Smile className="size-3" aria-hidden /> Expressive faces</Badge>
                )}
              </button>

              <div className="px-1.5 pb-1.5">
                <Button variant="ghost" size="sm" className="w-full justify-center text-xs" loading={busy === t.id}
                  disabled={!!busy || waiting} onClick={() => void makeOne(t)} aria-label={`${make}: ${t.label}`}>
                  {busy !== t.id && (path ? <RefreshCw className="size-3.5" aria-hidden /> : <ImageIcon className="size-3.5" aria-hidden />)}
                  {make}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">Every preview shows the same mom-and-baby moment, so the looks compare fairly. Your PC makes them when it has nothing else to do.</p>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpenId(null)} title={open ? `${open.emoji} ${open.label}` : "Preview"} description={open?.blurb}>
        {open && (
          <div className="space-y-3">
            <div className="relative mx-auto aspect-[9/16] w-full max-w-[min(100%,calc(62dvh*9/16))] overflow-hidden rounded-2xl bg-surface-2">
              <FadeImage src={signed(previewShown(open))} alt={`${open.label} preview`} loading="eager" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpenId(null)}>Close</Button>
              <Button disabled={open.id === value} onClick={() => { onChange(open.id); setOpenId(null); }}>
                <Check className="size-4" aria-hidden /> {open.id === value ? "The default" : "Use as default"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
