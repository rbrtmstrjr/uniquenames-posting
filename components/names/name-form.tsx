"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { Gender, NameRow } from "@/lib/db/types";
import { addNamesAction, updateNameAction } from "@/lib/actions/names";
import { normalizeName } from "@/lib/actions/helpers";
import { validateName } from "@/lib/actions/validate";

export function NameForm({ open, onOpenChange, editing, defaultGender, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: NameRow | null; defaultGender: Gender; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [meaning, setMeaning] = useState("");
  const [gender, setGender] = useState<Gender>(defaultGender);
  const [busy, setBusy] = useState(false);
  // Re-seed the fields whenever the dialog opens or switches to another name (done during render, not in an effect).
  const seedKey = open ? `open:${editing?.id ?? "new"}` : "closed";
  const [seeded, setSeeded] = useState(seedKey);
  if (seeded !== seedKey) {
    setSeeded(seedKey);
    if (open) { setName(editing?.name ?? ""); setMeaning(editing?.meaning ?? ""); setGender(editing?.gender ?? defaultGender); }
  }
  const problem = name || meaning ? validateName(name, meaning) : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (editing) {
      const r = await updateNameAction(editing.id, { name, meaning, gender });
      setBusy(false);
      if (!r.ok) { toast.error(r.error); return; }
    } else {
      const r = await addNamesAction([{ name, meaning, gender }]);
      setBusy(false);
      if (!r.ok) { toast.error(r.error); return; }
      if (r.skipped.length) { toast.error(`${normalizeName(name)} is already in your list.`); return; }
    }
    toast.success(editing ? "Name updated" : `Added ${normalizeName(name)}`);
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={editing ? "Edit name" : "Add a name"} description="Two words (Arlo Zenith) or one (Arlo). The style is set automatically.">
      <form onSubmit={save} className="space-y-4">
        <Segmented label="Gender" value={gender} onChange={setGender} options={[{ value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }]} />
        <label className="block"><span className="text-xs font-semibold text-muted">Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 font-semibold text-ink" /></label>
        <label className="block"><span className="text-xs font-semibold text-muted">Meaning</span>
          <input value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder="peak strength with calm" className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink" /></label>
        {problem && <p className="text-sm text-bad">{problem}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!!problem || !name || !meaning}>{editing ? "Save" : "Add name"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
