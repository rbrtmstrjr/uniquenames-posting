"use client";
import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleDashed, GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardRow, PostRow, ThemeRow } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Dialog } from "@/components/ui/dialog";
import { CardTile } from "@/components/cards/card-tile";
import { CardDialog } from "@/components/cards/card-dialog";
import { CaptionBox } from "./caption-box";
import { SaveActions } from "./save-actions";
import { statusBadge } from "./post-list";
import { useRealtimeRows } from "@/lib/realtime/use-table";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import { useHotkey } from "@/lib/realtime/hotkey";
import { useWorkerContext } from "@/components/shell/app-shell";
import { createClient } from "@/lib/supabase/client";
import { queuePosition } from "@/lib/status/card-state";
import { uploadNumbers } from "@/lib/files/save";
import { addCardAction, deletePostAction, setPostedAction } from "@/lib/actions/posts";
import { regenerateCardAction, reorderCardsAction, selectAllAction, setSelectedAction } from "@/lib/actions/cards";
import { callAction, optimistic } from "@/lib/actions/call";
import type { ActionResult } from "@/lib/actions/result";
import { useUndoableDelete } from "@/components/cards/use-undoable-delete";

const byOrder = (a: CardRow, b: CardRow) => a.order_index - b.order_index || a.position - b.position;

// The tile wrapper takes pointer/touch drags (press and hold on a phone). Keyboard reordering
// lives on a dedicated 44 px handle, so the tile never becomes a focusable role=button that
// nests the open/select buttons, and Space/Enter on those buttons cannot start a drag.
function Sortable({ id, name, children }: { id: string; name: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const { onKeyDown, ...pointerListeners } = (listeners ?? {}) as Record<string, React.KeyboardEventHandler & React.EventHandler<never>>;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={`relative select-none [-webkit-touch-callout:none] ${isDragging ? "scale-[1.03] opacity-90 shadow-soft" : ""}`} {...pointerListeners}>
      {children}
      <button type="button" ref={setActivatorNodeRef} {...attributes} onKeyDown={onKeyDown}
        aria-label={`Reorder ${name}. Press space, then the arrow keys, then space again.`}
        className="absolute right-0 top-0 z-[4] grid size-11 place-items-center text-white focus-visible:outline-2 focus-visible:outline-accent">
        <span className="grid size-7 place-items-center rounded-lg bg-black/30 shadow-soft"><GripVertical className="size-4" aria-hidden /></span>
      </button>
    </div>
  );
}

export function PostDetail({ post: initialPost, theme, initialCards }: { post: PostRow; theme: ThemeRow; initialCards: CardRow[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const { health } = useWorkerContext();
  const refetch = useCallback(async () => {
    const { data, error } = await createClient().from("cards").select("*").eq("post_id", initialPost.id);
    return error ? null : ((data ?? []) as CardRow[]);
  }, [initialPost.id]);
  const [cards, setCards] = useRealtimeRows<CardRow>("cards", initialCards, { key: `post-${initialPost.id}`, filter: `post_id=eq.${initialPost.id}`, sort: byOrder, refetch });
  const initialPostRows = useMemo(() => [initialPost], [initialPost]);
  const [posts, setPosts] = useRealtimeRows<PostRow>("posts", initialPostRows, { key: `post-row-${initialPost.id}`, filter: `id=eq.${initialPost.id}` });
  const post = posts[0] ?? initialPost;
  const { hidden, remove: deleteCard } = useUndoableDelete();
  const [openId, setOpenId] = useState<string | null>(params.get("card"));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const visible = useMemo(() => [...cards].sort(byOrder).filter((c) => !hidden.has(c.id)), [cards, hidden]);
  const numbers = uploadNumbers(visible);
  const urlFor = useSignedUrls(visible.map((c) => c.card_path));
  const open = visible.find((c) => c.id === openId) ?? null;
  const allSelected = visible.length > 0 && visible.every((c) => c.selected);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // Optimistic: the tile flips at once; a failed save puts it back and says why.
  const toggle = async (c: CardRow) => {
    const next = !c.selected;
    const set = (v: boolean) => setCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, selected: v } : x)));
    const r = await optimistic(() => set(next), () => set(!next), () => setSelectedAction(c.id, next));
    if (!r.ok) toast.error(r.error);
  };
  const selectAll = async () => {
    const next = !allSelected;
    const before = new Map(cards.map((c) => [c.id, c.selected]));
    const r = await optimistic(
      () => setCards((prev) => prev.map((x) => ({ ...x, selected: next }))),
      () => setCards((prev) => prev.map((x) => (before.has(x.id) ? { ...x, selected: before.get(x.id)! } : x))),
      () => selectAllAction(post.id, next));
    if (!r.ok) toast.error(r.error);
  };
  useHotkey("a", () => { if (!open && !confirmDelete) void selectAll(); });

  const retry = async (c: CardRow) => {
    const r = await callAction(() => regenerateCardAction(c.id));
    if (!r.ok) toast.error(r.error);
  };
  const retryAll = async (list: CardRow[]) => {
    setBusy("retry-all");
    const results = await Promise.all(list.map((c) => callAction(() => regenerateCardAction(c.id))));
    setBusy(null);
    const bad = results.find((r) => !r.ok);
    if (bad && !bad.ok) toast.error(bad.error);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = visible.map((c) => c.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    const before = new Map(cards.map((c) => [c.id, c.order_index]));
    const r = await optimistic(
      () => setCards((prev) => prev.map((c) => ({ ...c, order_index: next.indexOf(c.id) + 1 || c.order_index }))),
      () => setCards((prev) => prev.map((c) => (before.has(c.id) ? { ...c, order_index: before.get(c.id)! } : c))),
      () => reorderCardsAction(post.id, next));
    if (!r.ok) toast.error(r.error);
  };

  // Posted / not posted flips the badge and button at once (realtime confirms it).
  const setPosted = async (posted: boolean) => {
    if (busy === "posted") return;
    const prevStatus = post.status;
    const set = (status: PostRow["status"]) => setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, status } : p)));
    setBusy("posted");
    const r = await optimistic(() => set(posted ? "posted" : "ready"), () => set(prevStatus), () => setPostedAction(post.id, posted));
    setBusy(null);
    if (r.ok) toast.success(posted ? "Marked as posted" : "Marked as not posted"); else toast.error(r.error);
  };

  const run = async (key: string, fn: () => Promise<ActionResult>, ok: string) => {
    setBusy(key);
    const r = await callAction(fn);
    setBusy(null);
    if (r.ok) toast.success(ok); else toast.error(r.error);
    return r.ok;
  };

  const label = post.gender === "girl" ? "Girl" : "Boy";
  const failed = visible.filter((c) => c.status === "failed");

  return (
    <div className="space-y-4">
      <Link href="/posts" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="size-4" /> Posts</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink sm:text-3xl">
            {new Date(post.post_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {label}
          </h1>
          <p className="mt-1 text-sm text-muted">{theme.title} · {post.style} · {visible.length} cards</p>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge({ status: post.status, cards: visible })}
          {post.status === "posted"
            ? <Button variant="ghost" size="sm" aria-busy={busy === "posted"} onClick={() => void setPosted(false)}><CircleDashed className="size-4" /> Undo posted</Button>
            : <Button variant="subtle" size="sm" aria-busy={busy === "posted"} disabled={post.status !== "ready" && busy !== "posted"} onClick={() => void setPosted(true)}><CheckCircle2 className="size-4" /> Mark posted</Button>}
        </div>
      </div>

      {failed.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
          <span>{failed.length} card(s) failed. {failed[0].error}</span>
          <Button variant="danger" size="sm" loading={busy === "retry-all"} onClick={() => void retryAll(failed)}>Retry all</Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel title="Cards" action={
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted">{numbers.size} selected</span>
            <Button variant="ghost" size="sm" onClick={selectAll}>{allSelected ? "Select none" : "Select all"}</Button>
          </div>}>
          <p className="mb-3 text-xs text-muted">Tap a picture to open it. Tap the number to select or unselect. Drag to change the upload order (press and hold on a phone).</p>
          <DndContext id="cards-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={visible.map((c) => c.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {visible.map((c) => (
                  <Sortable key={c.id} id={c.id} name={c.name}>
                    <CardTile card={c} url={urlFor(c.card_path)} health={health} queuePos={queuePosition(c, visible)}
                      onOpen={() => setOpenId(c.id)} onRetry={() => retry(c)}
                      selection={{ selected: c.selected, order: numbers.get(c.id) ?? null, onToggle: () => void toggle(c) }} />
                  </Sortable>
                ))}
                <button type="button" onClick={() => run("add", () => addCardAction(post.id), "Adding one more card…")} disabled={busy === "add"} aria-busy={busy === "add"}
                  className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-line text-sm font-semibold text-muted transition hover:border-accent hover:text-accent active:scale-[.98] disabled:border-accent disabled:text-accent">
                  <span className="flex flex-col items-center gap-1">
                    {busy === "add" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Plus className="size-5" aria-hidden />} {busy === "add" ? "Adding…" : "Add a card"}
                  </span>
                </button>
              </div>
            </SortableContext>
          </DndContext>
        </Panel>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Panel title="Save for Facebook">
            <div className="space-y-4">
              <SaveActions post={post} cards={visible} caption={post.caption} />
              <CaptionBox postId={post.id} initial={post.caption} />
            </div>
          </Panel>
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" /> Delete post</Button>
        </div>
      </div>

      <CardDialog card={open} url={open ? urlFor(open.card_path) : undefined} health={health} onClose={() => setOpenId(null)} onDelete={deleteCard} />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this post?"
        description="Its cards are deleted from the website and its names and theme go back on the list. The copies on your PC stay.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
          <Button variant="danger" loading={busy === "delete"} onClick={async () => { if (await run("delete", () => deletePostAction(post.id), "Post deleted")) router.push("/posts"); }}>Delete post</Button>
        </div>
      </Dialog>
    </div>
  );
}
