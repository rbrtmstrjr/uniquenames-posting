"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ReelThemeId, ReelThemeRow } from "@/lib/db/types";
import { FadeImage } from "@/components/ui/fade-image";
import { callAction } from "@/lib/actions/call";
import { setReelThemeAction } from "@/lib/actions/reels";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import { previewPath } from "@/lib/reels/themes";
import { cn } from "@/lib/utils/cn";

/**
 * The review page's visual theme: a strip of preview thumbnails (wraps to a 4-column grid in the desktop side
 * panel). Saved right away (only while in script): the server rebuilds every line's picture prompt, then the
 * page refreshes. `value` is the reel's pinned theme.
 */
export function ThemePicker({ reelId, value, defaultId, themes, disabled, onSaved }: {
  reelId: string; value: ReelThemeId; defaultId: ReelThemeId; themes: ReelThemeRow[]; disabled?: boolean;
  onSaved?: (id: ReelThemeId) => void;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<ReelThemeId>(value);
  const [saving, setSaving] = useState<ReelThemeId | null>(null);
  // A newer value from the server (realtime / refresh) wins while nothing is being saved.
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); if (!saving) setChosen(value); }
  const signed = useSignedUrls(themes.map(previewPath), "reels");
  const current = themes.find((t) => t.id === chosen);
  const anyPreview = themes.some((t) => previewPath(t));

  const pick = async (t: ReelThemeRow) => {
    if (t.id === chosen || saving) return;
    const before = chosen;
    setChosen(t.id);
    setSaving(t.id);
    const r = await callAction(() => setReelThemeAction(reelId, t.id));
    setSaving(null);
    if (!r.ok) { setChosen(before); toast.error(r.error); return; }
    toast.success(`Theme: ${t.emoji} ${t.label}. Every picture will use it.`);
    onSaved?.(t.id);
    router.refresh();
  };

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span id="theme-label" className="text-xs font-semibold text-muted">Theme</span>
        <span className="min-w-0 truncate text-xs text-ink" data-testid="theme-current" aria-live="polite">
          {saving ? <span className="text-muted">Saving…</span> : current ? <><span aria-hidden>{current.emoji} </span><span className="font-semibold">{current.label}</span>{current.id === defaultId ? <span className="text-muted"> · default</span> : null}</> : null}
        </span>
      </div>
      <div role="radiogroup" aria-labelledby="theme-label" aria-busy={!!saving || undefined}
        className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pt-0.5 pb-2 [scrollbar-width:thin] lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0 lg:pb-0">
        {themes.map((t) => {
          const selected = t.id === chosen;
          const path = previewPath(t);
          return (
            <button key={t.id} type="button" role="radio" aria-checked={selected} aria-label={t.label} data-testid={`pick-${t.id}`}
              disabled={disabled || (!!saving && saving !== t.id)} onClick={() => void pick(t)}
              className={cn("group w-[4.5rem] shrink-0 snap-start text-left outline-none disabled:cursor-not-allowed lg:w-auto",
                !!saving && saving !== t.id && "opacity-60")}>
              <span className={cn("relative block aspect-[9/16] overflow-hidden rounded-xl bg-surface-2 ring-offset-2 ring-offset-surface transition",
                selected ? "ring-2 ring-accent" : "ring-1 ring-line group-hover:ring-accent/50",
                "group-focus-visible:ring-[3px] group-focus-visible:ring-ring/60")}>
                {path ? <FadeImage src={signed(path)} alt="" />
                  : <span aria-hidden className="absolute inset-0 grid place-items-center text-2xl">{t.emoji}</span>}
                {saving === t.id ? (
                  <span className="absolute inset-0 grid place-items-center bg-black/35 text-white"><Loader2 className="size-5 animate-spin" aria-hidden /></span>
                ) : selected ? (
                  <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-accent text-accent-ink shadow-soft"><Check className="size-3" aria-hidden /></span>
                ) : null}
              </span>
              <span className={cn("mt-1 block truncate text-[11px] leading-tight", selected ? "font-semibold text-ink" : "text-muted")}>
                <span aria-hidden>{t.emoji} </span>{t.label}
              </span>
            </button>
          );
        })}
      </div>
      {!anyPreview && (
        <p className="mt-1 text-xs text-muted">
          <Link href="/settings" className="font-semibold text-accent underline-offset-2 hover:underline">Make theme previews in Settings</Link> to see each look.
        </p>
      )}
    </div>
  );
}
