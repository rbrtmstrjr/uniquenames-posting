"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { CardRow } from "@/lib/db/types";
import { deleteCardAction } from "@/lib/actions/cards";
import { callAction } from "@/lib/actions/call";

const UNDO_MS = 5000;

// Hides a card at once and deletes it for real after 5 s unless the owner taps Undo.
// A failed delete brings the card back with an error toast.
export function useUndoableDelete() {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const unhide = (id: string) => setHidden((h) => { const n = new Set(h); n.delete(id); return n; });

  const remove = (c: CardRow) => {
    setHidden((h) => new Set(h).add(c.id));
    const toastId = `delete-${c.id}`;
    const t = setTimeout(async () => {
      timers.current.delete(c.id);
      toast.dismiss(toastId); // sonner pauses on hover / hidden tab: never leave a dead Undo behind
      const r = await callAction(() => deleteCardAction(c.id));
      if (!r.ok) { toast.error(r.error); unhide(c.id); }
    }, UNDO_MS);
    timers.current.set(c.id, t);
    toast(`Deleted ${c.name}`, {
      id: toastId,
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          if (!timers.current.has(c.id)) { toast.error("Already deleted"); return; }
          clearTimeout(timers.current.get(c.id));
          timers.current.delete(c.id);
          unhide(c.id);
        },
      },
    });
  };

  return { hidden, remove };
}
