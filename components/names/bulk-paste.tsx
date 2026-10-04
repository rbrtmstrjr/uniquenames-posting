"use client";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { Gender } from "@/lib/db/types";
import { parseBulkNames } from "@/lib/names/bulk-paste";
import { addNamesAction } from "@/lib/actions/names";
import { nameKey } from "@/lib/actions/helpers";

/** `existing` holds nameKey() values (normalized, lower-case) so the preview matches the server's dedup. */
export function BulkPaste({ open, onOpenChange, existing, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; existing: Set<string>; onSaved: () => void }) {
  const [gender, setGender] = useState<Gender>("boy");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseBulkNames(text, { gender }), [text, gender]);
  const { fresh, dupes } = useMemo(() => {
    const seen = new Set(existing);
    const fresh: typeof parsed.rows = [];
    const dupes: typeof parsed.rows = [];
    for (const r of parsed.rows) {
      const k = nameKey(r.name);
      if (seen.has(k)) dupes.push(r);
      else { seen.add(k); fresh.push(r); }
    }
    return { fresh, dupes };
  }, [parsed, existing]);

  const save = async () => {
    setBusy(true);
    const r = await addNamesAction(fresh);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`Added ${r.added} names${r.skipped.length ? `, skipped ${r.skipped.length} already in the list` : ""}`);
    setText("");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="Paste many names" description="One per line: Name - meaning. Two-word and single names can be mixed.">
      <div className="space-y-4">
        <Segmented label="Gender" value={gender} onChange={setGender} options={[{ value: "boy", label: "Boy names" }, { value: "girl", label: "Girl names" }]} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} aria-label="Names to add" placeholder={"Arlo Zenith - peak strength with calm\nLuna - the moon"}
          className="w-full rounded-xl border border-line bg-bg p-3 font-mono text-sm text-ink" />
        <div className="grid gap-3 sm:grid-cols-3 text-sm">
          <div className="rounded-xl bg-ok/10 p-3"><div className="text-2xl font-bold text-ok">{fresh.length}</div><div className="text-muted">new names ready</div></div>
          <div className="rounded-xl bg-surface-2 p-3"><div className="text-2xl font-bold text-ink">{dupes.length}</div><div className="text-muted">already in your list (skipped)</div></div>
          <div className="rounded-xl bg-bad/10 p-3"><div className="text-2xl font-bold text-bad">{parsed.issues.length}</div><div className="text-muted">lines with problems</div></div>
        </div>
        {parsed.issues.length > 0 && (
          <ul className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-line p-3 text-xs">
            {parsed.issues.map((i) => <li key={i.line}><span className="font-bold text-bad">Line {i.line}:</span> {i.reason} <span className="text-muted">({i.text})</span></li>)}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!fresh.length}>Add {fresh.length} names</Button>
        </div>
      </div>
    </Dialog>
  );
}
