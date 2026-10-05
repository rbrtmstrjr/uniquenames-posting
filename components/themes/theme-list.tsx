"use client";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowUpToLine, GripVertical, Loader2, Palette, Pencil, Plus, Sparkles } from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardRow, Gender, ThemeRow } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/segmented";
import { Disclosure } from "@/components/ui/disclosure";
import { FadeImage } from "@/components/ui/fade-image";
import { CardTile } from "@/components/cards/card-tile";
import { useRealtimeRows } from "@/lib/realtime/use-table";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import { useWorkerContext } from "@/components/shell/app-shell";
import { createClient } from "@/lib/supabase/client";
import { makePreviewAction, moveThemeNextAction, reorderThemesAction, setArchivedAction } from "@/lib/actions/themes";
import { callAction, optimistic } from "@/lib/actions/call";
import type { ActionResult } from "@/lib/actions/result";
import { Dialog } from "@/components/ui/dialog";
import { ThemeForm } from "./theme-form";

type Pending = "preview" | "archive" | "restore" | "next";

function Row({ t, next, pending, preview, url, onEdit, onOpen, onPreview, onArchive, onNext }: {
  t: ThemeRow; next: boolean; pending?: Pending; preview: CardRow | null; url?: string; onEdit: () => void; onOpen: () => void; onPreview: () => void; onArchive: () => void; onNext: () => void;
}) {
  const { health } = useWorkerContext();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });
  const busy = !!pending;
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex gap-2 rounded-2xl border border-line bg-surface p-3 shadow-soft ${isDragging ? "relative z-10 opacity-90" : ""}`}>
      <button type="button" ref={setActivatorNodeRef} className="grid w-11 shrink-0 cursor-grab touch-none place-items-center self-start rounded-xl text-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent" style={{ minHeight: 44 }}
        aria-label={`Reorder ${t.title}. Press space, then the arrow keys, then space again.`} {...attributes} {...listeners}>
        <GripVertical className="size-5" aria-hidden />
      </button>
      <div className={preview?.status === "failed" ? "w-36 shrink-0 sm:w-40" : "w-24 shrink-0 sm:w-28"}>
        {preview ? <CardTile card={preview} url={url} health={health} queuePos={0} onOpen={onOpen} onRetry={onPreview} />
          : (
            <button type="button" onClick={onPreview} disabled={busy} aria-busy={pending === "preview"}
              className="grid aspect-square w-full place-items-center rounded-xl border-2 border-dashed border-line text-[11px] font-semibold text-muted transition hover:border-accent hover:text-accent active:scale-[.98] disabled:opacity-55">
              <span className="flex flex-col items-center gap-1">
                {pending === "preview" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                {pending === "preview" ? "Starting…" : "Make preview"}
              </span>
            </button>
          )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{t.title}</span>
          {next && <Badge tone="accent">Next</Badge>}
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted">{t.backdrop} · {t.outfit} · {t.props}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}><Pencil className="size-4" aria-hidden /> Edit</Button>
          {preview && <Button variant="ghost" size="sm" disabled={busy} loading={pending === "preview"} onClick={onPreview}>{pending !== "preview" && <Sparkles className="size-4" aria-hidden />} New preview</Button>}
          {!next && <Button variant="ghost" size="sm" disabled={busy} onClick={onNext}><ArrowUpToLine className="size-4" aria-hidden /> Use next</Button>}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onArchive}><Archive className="size-4" aria-hidden /> Archive</Button>
        </div>
      </div>
    </li>
  );
}

export function ThemeList({ themes: serverThemes, previews: initialPreviews }: { themes: ThemeRow[]; previews: CardRow[] }) {
  const [gender, setGender] = useState<Gender>("boy");
  const [form, setForm] = useState<{ open: boolean; editing: ThemeRow | null }>({ open: false, editing: null });
  const [order, setOrder] = useState<string[] | null>(null);
  const [pending, setPending] = useState<Map<string, Pending>>(new Map());
  const [reordering, setReordering] = useState(false);
  const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);
  // Local copy for optimistic archive/restore. Each action's revalidatePath re-renders this page
  // in the same response: then take the server rows and drop the optimistic drag order
  // (adjust state during render).
  const [themes, setThemes] = useState(serverThemes);
  const [seedThemes, setSeedThemes] = useState(serverThemes);
  if (seedThemes !== serverThemes) { setSeedThemes(serverThemes); setThemes(serverThemes); setOrder(null); }

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

  const openTheme = themes.find((t) => t.id === openPreviewId) ?? null;
  const openCard = openTheme ? latestPreview.get(openTheme.id) ?? null : null;

  // One action per theme at a time; other themes stay usable. `apply`/`rollback` give instant feedback.
  const act = async (id: string, kind: Pending, fn: () => Promise<ActionResult>, ok: string, apply = () => {}, rollback = () => {}) => {
    if (pending.has(id)) return;
    setPending((m) => new Map(m).set(id, kind));
    const r = await optimistic(apply, rollback, fn);
    setPending((m) => { const n = new Map(m); n.delete(id); return n; });
    if (r.ok) toast.success(ok); else toast.error(r.error);
  };
  const setStatus = (t: ThemeRow, status: ThemeRow["status"]) => setThemes((list) => list.map((x) => (x.id === t.id ? { ...x, status } : x)));
  const archive = (t: ThemeRow, on: boolean) =>
    act(t.id, on ? "archive" : "restore", () => setArchivedAction(t.id, on), on ? `${t.title} archived. Restore it from the Archived list.` : `${t.title} restored`,
      () => setStatus(t, on ? "archived" : "available"), () => setStatus(t, t.status));
  const moveNext = (t: ThemeRow) => {
    const previous = order;
    const ids = available.map((x) => x.id);
    return act(t.id, "next", () => moveThemeNextAction(t.id), `${t.title} is next`,
      () => setOrder([t.id, ...ids.filter((x) => x !== t.id)]), () => setOrder(previous));
  };
  const makePreview = (t: ThemeRow) => act(t.id, "preview", () => makePreviewAction(t.id), "Making a preview… it appears here in about 30 s");

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id || reordering) return;
    const previous = order;
    const ids = available.map((t) => t.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    setReordering(true);
    // sort_order is only ever compared within one gender, so numbering this gender's list 1..n is safe.
    const r = await optimistic(() => setOrder(next), () => setOrder(previous), () => reorderThemesAction(next));
    setReordering(false);
    if (!r.ok) toast.error(r.error);
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
          <DndContext id="themes-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={available.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                {available.map((t, i) => {
                  const p = latestPreview.get(t.id) ?? null;
                  return (
                    <Row key={t.id} t={t} next={i === 0} pending={pending.get(t.id)} preview={p} url={urlFor(p?.card_path)}
                      onEdit={() => setForm({ open: true, editing: t })}
                      onOpen={() => setOpenPreviewId(t.id)}
                      onPreview={() => void makePreview(t)}
                      onArchive={() => void archive(t, true)}
                      onNext={() => void moveNext(t)} />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>
      {used.length > 0 && (
        <Disclosure summary={`Used · ${used.length}`} className="rounded-2xl border border-line bg-surface p-4" triggerClassName="text-sm text-ink">
          <ul className="mt-3 space-y-1 text-sm">{used.map((t) => <li key={t.id} className="flex justify-between gap-2"><span className="text-ink">{t.title}</span><span className="text-muted">{t.used_on}</span></li>)}</ul>
        </Disclosure>
      )}
      {archived.length > 0 && (
        <Disclosure summary={`Archived · ${archived.length}`} className="rounded-2xl border border-line bg-surface p-4" triggerClassName="text-sm text-ink">
          <ul className="mt-3 space-y-1">{archived.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 text-sm"><span className="text-ink">{t.title}</span>
              <Button variant="ghost" size="sm" disabled={pending.has(t.id)} onClick={() => void archive(t, false)}><ArchiveRestore className="size-4" aria-hidden /> Restore</Button></li>
          ))}</ul>
        </Disclosure>
      )}
      <Dialog open={!!openTheme} onOpenChange={(o) => !o && setOpenPreviewId(null)} title={openTheme ? `${openTheme.title} preview` : "Preview"} description="One test picture of this theme, to check the look before it is used.">
        {openTheme && (
          <div className="space-y-4">
            {openCard?.card_path ? (
              <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-2xl bg-surface-2">
                <FadeImage src={urlFor(openCard.card_path)} alt={`Preview of the ${openTheme.title} theme`} loading="eager" />
              </div>
            ) : (
              <p className="rounded-2xl bg-surface-2 p-6 text-center text-sm text-muted">This preview is not ready yet.</p>
            )}
            <div className="flex justify-end">
              <Button loading={pending.get(openTheme.id) === "preview"} disabled={pending.has(openTheme.id)} onClick={() => void makePreview(openTheme)}><Sparkles className="size-4" aria-hidden /> Make a new preview</Button>
            </div>
          </div>
        )}
      </Dialog>
      {/* saveThemeAction revalidates /themes, which re-renders this list in the same response */}
      <ThemeForm open={form.open} editing={form.editing} defaultGender={gender} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))} onSaved={() => {}} />
    </div>
  );
}
