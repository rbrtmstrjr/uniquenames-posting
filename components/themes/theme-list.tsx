"use client";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowUpToLine, Check, GripVertical, Loader2, Palette, Pencil, Plus, Sparkles, X } from "lucide-react";
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
import { approveThemesAction, makePreviewAction, moveThemeNextAction, rejectThemesAction, reorderThemesAction, setArchivedAction } from "@/lib/actions/themes";
import { suggestThemesAction } from "@/lib/actions/suggest";
import { THEME_COUNT } from "@/lib/ai/suggest-filter";
import { SuggestDialog } from "@/components/ui/suggest-dialog";
import { callAction, doneIds, optimistic } from "@/lib/actions/call";
import type { ActionResult } from "@/lib/actions/result";
import { Dialog } from "@/components/ui/dialog";
import { GenerateLockNote } from "@/components/shell/generate-lock-note";
import { canGenerate } from "@/lib/status/worker-health";
import { ThemeForm } from "./theme-form";

type Pending = "preview" | "archive" | "restore" | "next" | "approve" | "reject";

/** The theme's latest preview card, or a "Make preview" button (obeys the Generate lock). */
function PreviewSlot({ title, pending, preview, url, onOpen, onPreview }: {
  title: string; pending?: Pending; preview: CardRow | null; url?: string; onOpen: () => void; onPreview: () => void;
}) {
  const { health } = useWorkerContext();
  const gen = canGenerate(health);
  return (
    <div className={preview?.status === "failed" ? "w-36 shrink-0 sm:w-40" : "w-24 shrink-0 sm:w-28"}>
      {preview ? <CardTile card={preview} url={url} health={health} queuePos={0} onOpen={onOpen} onRetry={onPreview} />
        : (
          <button type="button" onClick={onPreview} disabled={!!pending || !gen.ok} aria-busy={pending === "preview"} aria-label={`Make a preview of ${title}`}
            className="grid aspect-square w-full place-items-center rounded-xl border-2 border-dashed border-line text-[11px] font-semibold text-muted transition hover:border-accent hover:text-accent active:scale-[.98] disabled:opacity-55">
            <span className="flex flex-col items-center gap-1" aria-hidden>
              {pending === "preview" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {pending === "preview" ? "Starting…" : "Make preview"}
            </span>
          </button>
        )}
    </div>
  );
}

/** An AI-suggested theme waiting for approval: the full set description, a preview, Approve / Edit / Reject. */
function PendingRow({ t, pending, preview, url, onOpen, onPreview, onApprove, onEdit, onReject }: {
  t: ThemeRow; pending?: Pending; preview: CardRow | null; url?: string; onOpen: () => void; onPreview: () => void; onApprove: () => void; onEdit: () => void; onReject: () => void;
}) {
  const gen = canGenerate(useWorkerContext().health);
  const busy = !!pending;
  return (
    <li className="flex gap-3 rounded-2xl border border-dashed border-accent/50 bg-surface p-3">
      <PreviewSlot title={t.title} pending={pending} preview={preview} url={url} onOpen={onOpen} onPreview={onPreview} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-words font-semibold text-ink">{t.title}</span>
          <Badge tone="accent">Suggested</Badge>
        </div>
        <dl className="mt-1 grid gap-0.5 text-xs text-muted">
          <div><dt className="inline font-semibold">Backdrop: </dt><dd className="inline">{t.backdrop}</dd></div>
          <div><dt className="inline font-semibold">Outfit: </dt><dd className="inline">{t.outfit}</dd></div>
          <div><dt className="inline font-semibold">Props: </dt><dd className="inline">{t.props}</dd></div>
          <div><dt className="inline font-semibold">Light: </dt><dd className="inline">{t.lighting}</dd></div>
          <div><dt className="inline font-semibold">Colors: </dt><dd className="inline">{t.palette}</dd></div>
        </dl>
        <div className="mt-2 flex flex-wrap gap-1">
          <Button size="sm" disabled={busy} loading={pending === "approve"} onClick={onApprove} aria-label={`Approve ${t.title}`}>{pending !== "approve" && <Check className="size-4" aria-hidden />} Approve</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onEdit} aria-label={`Edit ${t.title}`}><Pencil className="size-4" aria-hidden /> Edit</Button>
          {preview && <Button variant="ghost" size="sm" disabled={busy || !gen.ok} loading={pending === "preview"} onClick={onPreview}>{pending !== "preview" && <Sparkles className="size-4" aria-hidden />} New preview</Button>}
          <Button variant="ghost" size="sm" disabled={busy} loading={pending === "reject"} onClick={onReject} aria-label={`Reject ${t.title}`}>{pending !== "reject" && <X className="size-4 text-bad" aria-hidden />} Reject</Button>
        </div>
      </div>
    </li>
  );
}

function Row({ t, next, pending, preview, url, onEdit, onOpen, onPreview, onArchive, onNext }: {
  t: ThemeRow; next: boolean; pending?: Pending; preview: CardRow | null; url?: string; onEdit: () => void; onOpen: () => void; onPreview: () => void; onArchive: () => void; onNext: () => void;
}) {
  const { health } = useWorkerContext();
  const gen = canGenerate(health);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });
  const busy = !!pending;
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex gap-2 rounded-2xl border border-line bg-surface p-3 shadow-soft ${isDragging ? "relative z-10 opacity-90" : ""}`}>
      <button type="button" ref={setActivatorNodeRef} className="grid w-11 shrink-0 cursor-grab touch-none place-items-center self-start rounded-xl text-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent" style={{ minHeight: 44 }}
        aria-label={`Reorder ${t.title}. Press space, then the arrow keys, then space again.`} {...attributes} {...listeners}>
        <GripVertical className="size-5" aria-hidden />
      </button>
      <PreviewSlot title={t.title} pending={pending} preview={preview} url={url} onOpen={onOpen} onPreview={onPreview} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{t.title}</span>
          {next && <Badge tone="accent">Next</Badge>}
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted">{t.backdrop} · {t.outfit} · {t.props}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}><Pencil className="size-4" aria-hidden /> Edit</Button>
          {preview && <Button variant="ghost" size="sm" disabled={busy || !gen.ok} loading={pending === "preview"} onClick={onPreview}>{pending !== "preview" && <Sparkles className="size-4" aria-hidden />} New preview</Button>}
          {!next && <Button variant="ghost" size="sm" disabled={busy} onClick={onNext}><ArrowUpToLine className="size-4" aria-hidden /> Use next</Button>}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onArchive}><Archive className="size-4" aria-hidden /> Archive</Button>
        </div>
      </div>
    </li>
  );
}
export function ThemeList({ themes: serverThemes, previews: initialPreviews }: { themes: ThemeRow[]; previews: CardRow[] }) {
  const gen = canGenerate(useWorkerContext().health);
  const [gender, setGender] = useState<Gender>("boy");
  const [form, setForm] = useState<{ open: boolean; editing: ThemeRow | null }>({ open: false, editing: null });
  const [order, setOrder] = useState<string[] | null>(null);
  const [pending, setPending] = useState<Map<string, Pending>>(new Map());
  const [reordering, setReordering] = useState(false);
  const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);
  const [suggest, setSuggest] = useState(false);
  const [sgGender, setSgGender] = useState<Gender>("boy");
  const [confirmRejectAll, setConfirmRejectAll] = useState(false);
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
  // AI-suggested themes waiting for approval: never in Up next (never planned), listed on their own.
  const pendingThemes = mine.filter((t) => t.status === "pending").sort((a, b) => a.title.localeCompare(b.title));

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
  // Approve/reject suggestions, one or many: they move/disappear at once, a failure puts them back.
  const decide = async (list: ThemeRow[], approve: boolean) => {
    const rows = list.filter((t) => t.status === "pending" && !pending.has(t.id));
    if (!rows.length) return;
    const ids = rows.map((t) => t.id);
    const idSet = new Set(ids);
    setPending((m) => { const n = new Map(m); ids.forEach((id) => n.set(id, approve ? "approve" : "reject")); return n; });
    const end = Math.max(0, ...themes.filter((t) => t.status !== "pending").map((t) => t.sort_order));
    const r = await optimistic(
      () => setThemes((all) => (approve
        ? all.map((x) => (idSet.has(x.id) ? { ...x, status: "available" as const, sort_order: end + 1 + ids.indexOf(x.id) } : x))
        : all.filter((x) => !idSet.has(x.id)))),
      // A bulk call that stopped part-way keeps the themes it already changed; only the rest go back.
      (fail) => { const done = doneIds(fail); const back = rows.filter((t) => !done.has(t.id)); const undo = new Set(back.map((t) => t.id));
        setThemes((all) => [...all.filter((x) => !undo.has(x.id)), ...back]); },
      () => (approve ? approveThemesAction(ids) : rejectThemesAction(ids)));
    setPending((m) => { const n = new Map(m); ids.forEach((id) => n.delete(id)); return n; });
    const what = rows.length === 1 ? rows[0].title : `${rows.length} themes`;
    if (r.ok) toast.success(approve ? `${what} approved: added to the end of Up next` : `${what} rejected`); else toast.error(r.error);
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
        <div className="flex flex-wrap gap-2">
          <Button variant="subtle" onClick={() => { setSgGender(gender); setSuggest(true); }}><Sparkles className="size-4" aria-hidden /> Suggest with AI</Button>
          <Button onClick={() => setForm({ open: true, editing: null })}><Plus className="size-4" aria-hidden /> New theme</Button>
        </div>
      </div>
      {!gen.ok && <GenerateLockNote reason={gen.reason} extra="Previews are paused until then." />}
      {pendingThemes.length > 0 && (
        <section aria-labelledby="pending-themes" className="rounded-2xl border border-accent/40 bg-accent-soft/40 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="pending-themes" className="text-xs font-bold uppercase tracking-[.08em] text-ink">Pending approval · {pendingThemes.length}</h2>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void decide(pendingThemes, true)}><Check className="size-4" aria-hidden /> Approve all</Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmRejectAll(true)}><X className="size-4" aria-hidden /> Reject all</Button>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted">AI-suggested themes. Make a preview to judge the look; approved themes join the end of Up next, rejected ones are deleted.</p>
          <ul className="mt-3 space-y-2">
            {pendingThemes.map((t) => {
              const p = latestPreview.get(t.id) ?? null;
              return (
                <PendingRow key={t.id} t={t} pending={pending.get(t.id)} preview={p} url={urlFor(p?.card_path)}
                  onOpen={() => setOpenPreviewId(t.id)} onPreview={() => void makePreview(t)}
                  onApprove={() => void decide([t], true)} onEdit={() => setForm({ open: true, editing: t })} onReject={() => void decide([t], false)} />
              );
            })}
          </ul>
        </section>
      )}
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
            {!gen.ok && <GenerateLockNote reason={gen.reason} />}
            <div className="flex justify-end">
              <Button loading={pending.get(openTheme.id) === "preview"} disabled={pending.has(openTheme.id) || !gen.ok} onClick={() => void makePreview(openTheme)}><Sparkles className="size-4" aria-hidden /> Make a new preview</Button>
            </div>
          </div>
        )}
      </Dialog>
      <Dialog open={confirmRejectAll} onOpenChange={setConfirmRejectAll} title={`Reject ${pendingThemes.length} suggested themes?`} description="They are deleted, with any previews made of them. This can't be undone.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmRejectAll(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => { setConfirmRejectAll(false); void decide(pendingThemes, false); }}>Reject all</Button>
        </div>
      </Dialog>
      <SuggestDialog open={suggest} onOpenChange={setSuggest} noun="theme" title="Suggest themes with AI"
        description="Gemini designs new photoshoot sets. Titles or prop sets you already have are skipped; the rest wait for your approval."
        range={THEME_COUNT} defaultCount={5} ideaPlaceholder="e.g. autumn harvest, under the sea, cozy winter"
        fields={<Segmented label="Gender" value={sgGender} onChange={setSgGender} options={[{ value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }]} />}
        run={(count, vibe) => suggestThemesAction({ gender: sgGender, count, vibe })}
        onReview={() => { setGender(sgGender); setOrder(null); }} />
      {/* saveThemeAction revalidates /themes, which re-renders this list in the same response */}
      <ThemeForm open={form.open} editing={form.editing} defaultGender={gender} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))} onSaved={() => {}} />
    </div>
  );
}
