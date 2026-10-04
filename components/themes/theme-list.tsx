"use client";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowUpToLine, GripVertical, Palette, Pencil, Plus, Sparkles } from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardRow, Gender, ThemeRow } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/segmented";
import { CardTile } from "@/components/cards/card-tile";
import { useRealtimeRows } from "@/lib/realtime/use-table";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import { useWorkerContext } from "@/components/shell/app-shell";
import { createClient } from "@/lib/supabase/client";
import { makePreviewAction, moveThemeNextAction, reorderThemesAction, setArchivedAction } from "@/lib/actions/themes";
import { ThemeForm } from "./theme-form";

function Row({ t, next, busy, preview, url, onEdit, onPreview, onArchive, onNext }: {
  t: ThemeRow; next: boolean; busy: boolean; preview: CardRow | null; url?: string; onEdit: () => void; onPreview: () => void; onArchive: () => void; onNext: () => void;
}) {
  const { health } = useWorkerContext();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex gap-2 rounded-2xl border border-line bg-surface p-3 shadow-soft ${isDragging ? "relative z-10 opacity-90" : ""}`}>
      <button type="button" ref={setActivatorNodeRef} className="grid w-11 shrink-0 cursor-grab touch-none place-items-center self-start rounded-xl text-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent" style={{ minHeight: 44 }}
        aria-label={`Reorder ${t.title}. Press space, then the arrow keys, then space again.`} {...attributes} {...listeners}>
        <GripVertical className="size-5" aria-hidden />
      </button>
      <div className="w-24 shrink-0 sm:w-28">
        {preview ? <CardTile card={preview} url={url} health={health} queuePos={0} />
          : <button type="button" onClick={onPreview} disabled={busy} className="grid aspect-square w-full place-items-center rounded-xl border-2 border-dashed border-line text-[11px] font-semibold text-muted hover:border-accent hover:text-accent disabled:opacity-55"><span className="flex flex-col items-center gap-1"><Sparkles className="size-4" aria-hidden /> Make preview</span></button>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{t.title}</span>
          {next && <Badge tone="accent">Next</Badge>}
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted">{t.backdrop} · {t.outfit} · {t.props}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}><Pencil className="size-4" aria-hidden /> Edit</Button>
          {preview && <Button variant="ghost" size="sm" disabled={busy} onClick={onPreview}><Sparkles className="size-4" aria-hidden /> New preview</Button>}
          {!next && <Button variant="ghost" size="sm" disabled={busy} onClick={onNext}><ArrowUpToLine className="size-4" aria-hidden /> Use next</Button>}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onArchive}><Archive className="size-4" aria-hidden /> Archive</Button>
        </div>
      </div>
    </li>
  );
}

export function ThemeList({ themes, previews: initialPreviews }: { themes: ThemeRow[]; previews: CardRow[] }) {
  const router = useRouter();
  const [gender, setGender] = useState<Gender>("boy");
  const [form, setForm] = useState<{ open: boolean; editing: ThemeRow | null }>({ open: false, editing: null });
  const [order, setOrder] = useState<string[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Drop the optimistic drag order once the server hands us fresh themes (adjust state during render).
  const [seedThemes, setSeedThemes] = useState(themes);
  if (seedThemes !== themes) { setSeedThemes(themes); setOrder(null); }

  const refetch = useCallback(async () => {
    const { data, error } = await createClient().from("cards").select("*").eq("kind", "preview");
    return error ? null : ((data ?? []) as CardRow[]);
  }, []);
  const [previews] = useRealtimeRows<CardRow>("cards", initialPreviews, { key: "previews", filter: "kind=eq.preview", refetch });
  const latestPreview = useMemo(() => {
    const m = new Map<string, CardRow>();
    [...previews].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).forEach((p) => m.set(p.theme_id, p));
    return m;
  }, [previews]);
  const urlFor = useSignedUrls([...latestPreview.values()].map((p) => p.card_path));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const mine = themes.filter((t) => t.gender === gender);
  const availableSorted = mine.filter((t) => t.status === "available").sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
  const available = order
    ? [...order.map((id) => availableSorted.find((t) => t.id === id)).filter((t): t is ThemeRow => !!t), ...availableSorted.filter((t) => !order.includes(t.id))]
    : availableSorted;
  const used = mine.filter((t) => t.status === "used").sort((a, b) => (b.used_on ?? "").localeCompare(a.used_on ?? ""));
  const archived = mine.filter((t) => t.status === "archived");

  const act = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const r = await fn();
      if (r.ok) { toast.success(ok); setOrder(null); router.refresh(); } else toast.error(r.error ?? "Something went wrong.");
    } finally { setBusyId(null); }
  };
  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id || busyId) return;
    const ids = available.map((t) => t.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    setOrder(next);
    // sort_order is only ever compared within one gender, so numbering this gender's list 1..n is safe.
    const r = await reorderThemesAction(next);
    if (!r.ok) { toast.error(r.error); setOrder(null); } else router.refresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Gender" value={gender} onChange={(g) => { setGender(g); setOrder(null); }} options={[{ value: "boy", label: "Boy themes" }, { value: "girl", label: "Girl themes" }]} />
        <Button onClick={() => setForm({ open: true, editing: null })}><Plus className="size-4" aria-hidden /> New theme</Button>
      </div>
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-[.08em] text-muted">Up next · {available.length} left</h2>
        {available.length === 0 ? (
          <Empty icon={<Palette className="size-6" />} title={`No ${gender} themes left`} text="Add a new photoshoot theme, or restore an archived one." action={<Button onClick={() => setForm({ open: true, editing: null })}><Plus className="size-4" aria-hidden /> New theme</Button>} />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={available.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                {available.map((t, i) => {
                  const p = latestPreview.get(t.id) ?? null;
                  return (
                    <Row key={t.id} t={t} next={i === 0} busy={busyId !== null} preview={p} url={urlFor(p?.card_path)}
                      onEdit={() => setForm({ open: true, editing: t })}
                      onPreview={() => act(t.id, () => makePreviewAction(t.id), "Making a preview… it appears here in about 30 s")}
                      onArchive={() => act(t.id, () => setArchivedAction(t.id, true), `${t.title} archived. Restore it from the Archived list.`)}
                      onNext={() => act(t.id, () => moveThemeNextAction(t.id), `${t.title} is next`)} />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>
      {used.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface p-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink">Used · {used.length}</summary>
          <ul className="mt-3 space-y-1 text-sm">{used.map((t) => <li key={t.id} className="flex justify-between gap-2"><span className="text-ink">{t.title}</span><span className="text-muted">{t.used_on}</span></li>)}</ul>
        </details>
      )}
      {archived.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface p-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink">Archived · {archived.length}</summary>
          <ul className="mt-3 space-y-1">{archived.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 text-sm"><span className="text-ink">{t.title}</span>
              <Button variant="ghost" size="sm" disabled={busyId !== null} onClick={() => act(t.id, () => setArchivedAction(t.id, false), `${t.title} restored`)}><ArchiveRestore className="size-4" aria-hidden /> Restore</Button></li>
          ))}</ul>
        </details>
      )}
      <ThemeForm open={form.open} editing={form.editing} defaultGender={gender} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))} onSaved={() => router.refresh()} />
    </div>
  );
}
