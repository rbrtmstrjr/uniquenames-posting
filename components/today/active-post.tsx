"use client";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import type { CardRow, PostRow } from "@/lib/db/types";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { CardTile } from "@/components/cards/card-tile";
import { useRealtimeRows } from "@/lib/realtime/use-table";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import { useWorkerContext } from "@/components/shell/app-shell";
import { queuePosition } from "@/lib/status/card-state";
import { etaSeconds, formatEta } from "@/lib/status/eta";
import { createClient } from "@/lib/supabase/client";
import { regenerateCardAction } from "@/lib/actions/cards";
import { callAction } from "@/lib/actions/call";
import { CardDialog } from "@/components/cards/card-dialog";
import { useUndoableDelete } from "@/components/cards/use-undoable-delete";

export function ActivePost({ post, initialCards }: { post: PostRow; initialCards: CardRow[] }) {
  const { health } = useWorkerContext();
  const refetch = useCallback(async () => {
    const { data, error } = await createClient().from("cards").select("*").eq("post_id", post.id).order("position");
    return error ? null : ((data ?? []) as CardRow[]);
  }, [post.id]);
  const [allCards] = useRealtimeRows<CardRow>("cards", initialCards, { key: `today-${post.id}`, filter: `post_id=eq.${post.id}`, sort: (a, b) => a.position - b.position, refetch });
  const { hidden, remove } = useUndoableDelete();
  const cards = useMemo(() => allCards.filter((c) => !hidden.has(c.id)), [allCards, hidden]);
  // The card opens right here (no page load); its live row keeps the dialog current.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = cards.find((c) => c.id === openId) ?? null;
  const urlFor = useSignedUrls(cards.map((c) => c.card_path));
  const done = cards.filter((c) => c.status === "done").length;
  const failed = cards.filter((c) => c.status === "failed").length;
  const durations = cards.filter((c) => c.finished_at && c.started_at).map((c) => (Date.parse(c.finished_at!) - Date.parse(c.started_at!)) / 1000);
  const pct = cards.length ? Math.round((done / cards.length) * 100) : 0;
  const finished = done === cards.length && cards.length > 0;
  const label = post.gender === "girl" ? "Girl" : "Boy";

  return (
    <Panel
      title={finished ? "Just finished" : "Making now"}
      action={<Link href={`/posts/${post.id}`} className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-accent">Open post <ArrowRight className="size-3.5" /></Link>}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-ink">{new Date(post.post_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {label} · {post.style}</div>
          <div className="text-sm text-muted" aria-live="polite">
            {finished ? `All ${cards.length} cards are ready.` : `${done} of ${cards.length} cards · ${formatEta(etaSeconds(cards.length - done - failed, durations))}`}
          </div>
        </div>
        {failed > 0 ? <Badge tone="bad">{failed} failed</Badge> : finished ? <Badge tone="ok">Ready</Badge> : <Badge tone="accent" pulse>Generating</Badge>}
      </div>
      <div className="my-4 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Cards finished">
        <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      {/* Phones/tablets: full width. Desktop: the narrow right column next to New post. */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">
        {cards.map((c) => (
          <CardTile key={c.id} card={c} url={urlFor(c.card_path)} health={health} queuePos={queuePosition(c, cards)}
            onOpen={() => setOpenId(c.id)}
            onRetry={async () => { const r = await callAction(() => regenerateCardAction(c.id)); if (!r.ok) toast.error(r.error); }} />
        ))}
      </div>
      <CardDialog card={open} url={open ? urlFor(open.card_path) : undefined} health={health} onClose={() => setOpenId(null)} onDelete={remove} />
    </Panel>
  );
}
