"use client";
import { useState } from "react";
import { RotateCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CardRow } from "@/lib/db/types";
import { cardVisual } from "@/lib/status/card-state";
import type { WorkerHealth } from "@/lib/status/worker-health";
import { regenerateCardAction, restampCardAction } from "@/lib/actions/cards";
import { CardTile } from "./card-tile";

export function CardDialog({ card, url, health, onClose, onDelete }: {
  card: CardRow | null; url?: string; health: WorkerHealth; onClose: () => void; onDelete: (c: CardRow) => void;
}) {
  const [name, setName] = useState("");
  const [meaning, setMeaning] = useState("");
  const [busy, setBusy] = useState<"text" | "regen" | null>(null);
  // Re-seed the fields when a different card opens (adjust state during render).
  const [seededId, setSeededId] = useState<string | null>(null);
  if (card && card.id !== seededId) { setSeededId(card.id); setName(card.name); setMeaning(card.meaning); }
  if (!card) return null;
  const v = cardVisual(card, health);
  const working = card.status === "generating";
  const changed = name.trim() !== card.name || meaning.trim().toLowerCase() !== card.meaning;
  const took = card.started_at && card.finished_at ? Math.round((Date.parse(card.finished_at) - Date.parse(card.started_at)) / 1000) : null;

  const saveText = async () => {
    setBusy("text");
    const r = await restampCardAction(card.id, name, meaning);
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.mode === "restamp" ? "Updating the text… (about a second once your PC picks it up)" : "This older card has no clean photo, so it is being remade with the new text.");
  };
  const regen = async () => {
    setBusy("regen");
    const r = await regenerateCardAction(card.id);
    setBusy(null);
    if (r.ok) toast.success("Making a new picture for this card…"); else toast.error(r.error);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${card.position}. ${card.name}`} description={card.meaning} wide>
      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
        <CardTile card={card} url={url} health={health} queuePos={0} className="rounded-2xl" />
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone={v === "done" ? "ok" : v === "failed" ? "bad" : v === "waiting" ? "warn" : "accent"} pulse={!["done", "failed"].includes(v)}>
              {({ queued: "In line", generating: "Being made", regenerating: "Being remade", restamp: "Updating text", done: "Ready", failed: "Failed", waiting: "Waiting for your PC" } as const)[v]}
            </Badge>
            {took !== null && v === "done" && <Badge tone="muted">Made in {took}s</Badge>}
            {card.attempts > 1 && <Badge tone="muted">{card.attempts} tries</Badge>}
          </div>
          {card.error && <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{card.error}</p>}
          <label className="block">
            <span className="text-xs font-semibold text-muted">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 font-semibold text-ink" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted">Meaning</span>
            <input value={meaning} onChange={(e) => setMeaning(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveText} loading={busy === "text"} disabled={!changed || working}><Save className="size-4" /> Save text</Button>
            <Button variant="subtle" onClick={regen} loading={busy === "regen"} disabled={working}><RotateCw className="size-4" /> New picture</Button>
            <Button variant="danger" onClick={() => { onDelete(card); onClose(); }} disabled={working}><Trash2 className="size-4" /> Delete</Button>
          </div>
          <details className="text-xs text-muted">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Shot and prompt</summary>
            <p className="mt-2 whitespace-pre-wrap">{card.prompt}</p>
          </details>
        </div>
      </div>
    </Dialog>
  );
}
