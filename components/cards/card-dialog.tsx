"use client";
import { useState } from "react";
import { RotateCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/shadcn/input";
import { GenerateLockNote } from "@/components/shell/generate-lock-note";
import type { CardRow } from "@/lib/db/types";
import { canGenerate, type WorkerHealth } from "@/lib/status/worker-health";
import { dialogStatus, newPictureAction, textChanged } from "@/lib/status/card-dialog";
import { restampMode } from "@/lib/actions/helpers";
import { regenerateCardAction, restampCardAction } from "@/lib/actions/cards";
import { callAction, optimistic } from "@/lib/actions/call";
import { useNow } from "@/lib/realtime/hooks";
import { CardTile } from "./card-tile";
import { NameIdeas } from "./name-ideas";

type Base = { id: string; name: string; meaning: string };

// `card` is the live realtime row from PostDetail (never a copy), so the header and tile
// follow the card through in line -> making -> ready while the dialog stays open.
// `onPatch` applies an optimistic local change to that row (realtime then confirms it).
export function CardDialog({ card, url, health, queuePos = 0, onClose, onDelete, onPatch }: {
  card: CardRow | null; url?: string; health: WorkerHealth; queuePos?: number; onClose: () => void; onDelete: (c: CardRow) => void;
  onPatch?: (id: string, patch: Partial<CardRow>) => void;
}) {
  const [name, setName] = useState("");
  const [meaning, setMeaning] = useState("");
  const [busy, setBusy] = useState<"text" | "regen" | null>(null);
  const now = useNow(1000);
  // Seed the fields when a card opens; when its saved text changes underneath (realtime),
  // follow it unless the owner has unsaved edits (adjust state during render).
  const [base, setBase] = useState<Base | null>(null);
  if (card && (card.id !== base?.id || card.name !== base.name || card.meaning !== base.meaning)) {
    const clean = !base || card.id !== base.id || !textChanged(base, name, meaning);
    setBase({ id: card.id, name: card.name, meaning: card.meaning });
    if (clean) { setName(card.name); setMeaning(card.meaning); }
  }
  if (!card) { if (base !== null) setBase(null); return null; }

  const status = dialogStatus(card, health, queuePos, now);
  const working = card.status === "generating";
  const changed = textChanged(card, name, meaning);
  const gen = canGenerate(health);
  // Editing text re-stamps the current photo (Pillow only); a card without a clean photo has to regenerate.
  const textNeedsPhoto = restampMode(card) === "regenerate";
  const textLocked = textNeedsPhoto && !gen.ok;
  const took = card.started_at && card.finished_at ? Math.round((Date.parse(card.finished_at) - Date.parse(card.started_at)) / 1000) : null;

  // Only the status flips optimistically. The text arrives with the realtime row, so a failed
  // save never rolls the name back over the owner's edit in the field.
  const before: Partial<CardRow> = { status: card.status, claimed_at: card.claimed_at, error: card.error, started_at: card.started_at, finished_at: card.finished_at };
  const patch = (p: Partial<CardRow>) => onPatch?.(card.id, p);

  const saveText = async () => {
    setBusy("text");
    const r = await callAction(() => restampCardAction(card.id, name, meaning));
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.mode === "restamp" ? "Updating the text… (about a second once your PC picks it up)" : "This older card has no clean photo, so it is being remade with the new text.");
  };
  const regen = async () => {
    const choice = newPictureAction(card, name, meaning);
    setBusy("regen");
    const r = await optimistic(
      () => patch({ status: "queued", claimed_at: null, error: null, started_at: null, finished_at: null }),
      () => patch(before),
      () => (choice.kind === "edit-regenerate" ? regenerateCardAction(card.id, { name: choice.name, meaning: choice.meaning }) : regenerateCardAction(card.id)));
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(choice.kind === "edit-regenerate" ? "Saved the new text. Making a new picture with it…" : "Making a new picture for this card…");
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${card.position}. ${card.name}`} description={card.meaning} wide>
      <div className="mb-4 flex flex-wrap gap-2" aria-live="polite">
        <Badge tone={status.tone} pulse={status.pulse}>{status.label}</Badge>
        {took !== null && card.status === "done" && <Badge tone="muted">Made in {took}s</Badge>}
        {card.attempts > 1 && <Badge tone="muted">{card.attempts} tries</Badge>}
      </div>
      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
        <CardTile card={card} url={url} health={health} queuePos={queuePos} className="rounded-2xl" />
        <div className="space-y-4">
          {card.error && <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{card.error}</p>}
          <label className="block">
            <span className="text-xs font-semibold text-muted">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 font-semibold" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted">Meaning</span>
            <Input value={meaning} onChange={(e) => setMeaning(e.target.value)} className="mt-1" />
          </label>
          {card.post_id && <NameIdeas cardId={card.id} current={name} onPick={(i) => { setName(i.name); setMeaning(i.meaning); }} />}
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveText} loading={busy === "text"} disabled={!changed || working || textLocked || busy !== null}><Save className="size-4" /> Save text</Button>
            <Button variant="subtle" onClick={regen} loading={busy === "regen"} disabled={working || !gen.ok || busy !== null}>
              <RotateCw className="size-4" /> {changed ? "New picture with this text" : "New picture"}
            </Button>
            <Button variant="danger" onClick={() => { onDelete(card); onClose(); }} disabled={working}><Trash2 className="size-4" /> Delete</Button>
          </div>
          {!gen.ok && <GenerateLockNote reason={gen.reason} extra={textNeedsPhoto ? undefined : "Text edits still save."} />}
          <Disclosure summary="Shot and prompt" className="text-xs text-muted">
            <p className="mt-2 whitespace-pre-wrap">{card.prompt}</p>
          </Disclosure>
        </div>
      </div>
    </Dialog>
  );
}
