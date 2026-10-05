"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Input } from "@/components/ui/shadcn/input";
import { Textarea } from "@/components/ui/shadcn/textarea";
import type { Gender, ThemeRow } from "@/lib/db/types";
import { saveThemeAction } from "@/lib/actions/themes";
import { callAction } from "@/lib/actions/call";

const FIELDS = [
  { key: "backdrop", label: "Backdrop", hint: "Always a seamless studio backdrop, e.g. smooth seamless sage green studio backdrop" },
  { key: "outfit", label: "Outfit", hint: "e.g. cream cable-knit romper with a tiny bonnet" },
  { key: "props", label: "Props", hint: "Keep them short and low, e.g. wicker basket, small pumpkins, knitted blanket" },
  { key: "lighting", label: "Lighting", hint: "e.g. warm low golden light, cozy" },
  { key: "palette", label: "Color palette", hint: "e.g. rust, mustard, cream and brown" },
] as const;

type Form = { title: string; gender: Gender; backdrop: string; outfit: string; props: string; lighting: string; palette: string };
const EMPTY: Form = { title: "", gender: "boy", backdrop: "", outfit: "", props: "", lighting: "", palette: "" };
const fromTheme = (t: ThemeRow): Form => ({ title: t.title, gender: t.gender, backdrop: t.backdrop, outfit: t.outfit, props: t.props, lighting: t.lighting, palette: t.palette });

export function ThemeForm({ open, onOpenChange, editing, defaultGender, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: ThemeRow | null; defaultGender: Gender; onSaved: () => void;
}) {
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  // Re-seed the fields whenever the dialog opens or switches to another theme (during render, not in an effect).
  const seedKey = open ? `open:${editing?.id ?? "new"}` : "closed";
  const [seeded, setSeeded] = useState(seedKey);
  if (seeded !== seedKey) {
    setSeeded(seedKey);
    if (open) setF(editing ? fromTheme(editing) : { ...EMPTY, gender: defaultGender });
  }
  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const r = await callAction(() => saveThemeAction({ ...f, id: editing?.id }));
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(editing ? "Theme saved" : "Theme added to the end of the line");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title={editing ? "Edit theme" : "New theme"}
      description="Every picture in a post repeats these words exactly, so the whole album looks like one photoshoot.">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="text-xs font-semibold text-muted">Title</span>
          <Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Autumn Harvest" className="mt-1 font-semibold" /></label>
        <div className="sm:col-span-2"><Segmented label="Gender" value={f.gender} onChange={(v) => set("gender", v)} options={[{ value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }]} /></div>
        {FIELDS.map((x) => (
          <label key={x.key} className="block">
            <span className="text-xs font-semibold text-muted">{x.label}</span>
            <Textarea value={f[x.key]} onChange={(e) => set(x.key, e.target.value)} rows={2} placeholder={x.hint} className="mt-1" />
          </label>
        ))}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={busy}>{editing ? "Save theme" : "Add theme"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
