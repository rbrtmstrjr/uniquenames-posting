"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleDashed, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
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
import { deleteCardAction, regenerateCardAction, reorderCardsAction, selectAllAction, setSelectedAction } from "@/lib/actions/cards";

const byOrder = (a: CardRow, b: CardRow) => a.order_index - b.order_index || a.position - b.position;

function Sortable({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={isDragging ? "scale-[1.03] opacity-90 shadow-soft" : ""} {...attributes} {...listeners}>
      {children}
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
  const [posts] = useRealtimeRows<PostRow>("posts", initialPostRows, { key: `post-row-${initialPost.id}`, filter: `id=eq.${initialPost.id}` });
  const post = posts[0] ?? initialPost;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(params.get("card"));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const visible = useMemo(() => [...cards].sort(byOrder).filter((c) => !hidden.has(c.id)), [cards, hidden]);
  const numbers = uploadNumbers(visible);
  const urlFor = useSignedUrls(visible.map((c) => c.card_path));
  const open = visible.find((c) => c.id === openId) ?? null;
  const allSelected = visible.length > 0 && visible.every((c) => c.selected);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));

  const toggle = async (c: CardRow) => {
    setCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, selected: !x.selected } : x)));
    const r = await setSelectedAction(c.id, !c.selected);
    if (!r.ok) toast.error(r.error);
  };
  const selectAll = async () => {
    const next = !allSelected;
    setCards((prev) => prev.map((x) => ({ ...x, selected: next })));
    const r = await selectAllAction(post.id, next);
    if (!r.ok) toast.error(r.error);
  };
  useHotkey("a", selectAll);

  const retry = async (c: CardRow) => {
    const r = await regenerateCardAction(c.id);
    if (!r.ok) toast.error(r.error);
  };
  const retryAll = async (list: CardRow[]) => {
    const results = await Promise.all(list.map((c) => regenerateCardAction(c.id)));
    const bad = results.find((r) => !r.ok);
    if (bad && !bad.ok) toast.error(bad.error);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = visible.map((c) => c.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    setCards((prev) => prev.map((c) => ({ ...c, order_index: next.indexOf(c.id) + 1 || c.order_index })));
    const r = await reorderCardsAction(post.id, next);
    if (!r.ok) toast.error(r.error);
  };

  const deleteCard = (c: CardRow) => {
    setHidden((h) => new Set(h).add(c.id));
    const t = setTimeout(async () => {
      timers.current.delete(c.id);
      const r = await deleteCardAction(c.id);
      if (!r.ok) { toast.error(r.error); setHidden((h) => { const n = new Set(h); n.delete(c.id); return n; }); }
    }, 5000);
    timers.current.set(c.id, t);
    toast(`Deleted ${c.name}`, {
      duration: 5000,
      action: { label: "Undo", onClick: () => { clearTimeout(timers.current.get(c.id)); timers.current.delete(c.id); setHidden((h) => { const n = new Set(h); n.delete(c.id); return n; }); } },
    });
  };

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (r.ok) toast.success(ok); else toast.error(r.error ?? "Something went wrong.");
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
            ? <Button variant="ghost" size="sm" loading={busy === "posted"} onClick={() => run("posted", () => setPostedAction(post.id, false), "Marked as not posted")}><CircleDashed className="size-4" /> Undo posted</Button>
            : <Button variant="subtle" size="sm" loading={busy === "posted"} disabled={post.status !== "ready"} onClick={() => run("posted", () => setPostedAction(post.id, true), "Marked as posted")}><CheckCircle2 className="size-4" /> Mark posted</Button>}
        </div>
      </div>

      {failed.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
          <span>{failed.length} card(s) failed. {failed[0].error}</span>
          <Button variant="danger" size="sm" onClick={() => void retryAll(failed)}>Retry all</Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel title="Cards" action={
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted">{numbers.size} selected</span>
            <Button variant="ghost" size="sm" onClick={selectAll}>{allSelected ? "Select none" : "Select all"}</Button>
          </div>}>
          <p className="mb-3 text-xs text-muted">Tap a picture to open it. Tap the number to select or unselect. Drag to change the upload order (press and hold on a phone).</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={visible.map((c) => c.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {visible.map((c) => (
                  <Sortable key={c.id} id={c.id}>
                    <CardTile card={c} url={urlFor(c.card_path)} health={health} queuePos={queuePosition(c, visible)}
                      onOpen={() => setOpenId(c.id)} onRetry={() => retry(c)}
                      selection={{ selected: c.selected, order: numbers.get(c.id) ?? null, onToggle: () => void toggle(c) }} />
                  </Sortable>
                ))}
                <button type="button" onClick={() => run("add", () => addCardAction(post.id), "Adding one more card…")} disabled={busy === "add"}
                  className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-line text-sm font-semibold text-muted hover:border-accent hover:text-accent">
                  <span className="flex flex-col items-center gap-1"><Plus className="size-5" /> Add a card</span>
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
