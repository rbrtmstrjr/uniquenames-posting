"use client";
import { useMemo, useState } from "react";
import { Ban, Check, ClipboardPaste, Pencil, Plus, Search, Sparkles, Trash2, Undo2, Type, X } from "lucide-react";
import { toast } from "sonner";
import type { Gender, NameRow, NameStatus, NameStyle } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/segmented";
import { Input } from "@/components/ui/shadcn/input";
import { approveNamesAction, deleteNameAction, rejectNamesAction, setSkipAction } from "@/lib/actions/names";
import { suggestNamesAction } from "@/lib/actions/suggest";
import { NAME_COUNT } from "@/lib/ai/suggest-filter";
import { SuggestDialog } from "@/components/ui/suggest-dialog";
import { doneIds, optimistic } from "@/lib/actions/call";
import type { ActionResult } from "@/lib/actions/result";
import { nameKey } from "@/lib/actions/helpers";
import { Dialog } from "@/components/ui/dialog";
import { NameForm } from "./name-form";
import { BulkPaste } from "./bulk-paste";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/shadcn/select";
import { AZ_LETTERS, letterOf } from "@/lib/series/az";

import type { NamesFilter } from "@/lib/names/filter";

const STATUS_TONE: Record<NameStatus, "ok" | "accent" | "muted" | "warn"> = { available: "ok", reserved: "accent", used: "muted", skip: "warn", pending: "accent" };
const STATUS_TEXT: Record<NameStatus, string> = { available: "Available", reserved: "In a post", used: "Used", skip: "Skip", pending: "Pending" };

export function NamesTable({ names: serverNames, initial = {} }: { names: NameRow[]; initial?: NamesFilter }) {
  // Local copy for optimistic updates; re-seeded whenever the server sends fresh rows
  // (each action's revalidatePath re-renders this page in the same response).
  const [names, setNames] = useState(serverNames);
  const [seed, setSeed] = useState(serverNames);
  if (seed !== serverNames) { setSeed(serverNames); setNames(serverNames); }
  const [q, setQ] = useState("");
  const [gender, setGender] = useState<"all" | Gender>(initial.gender ?? "all");
  const [style, setStyle] = useState<"all" | NameStyle>(initial.style ?? "all");
  const [status, setStatus] = useState<"all" | NameStatus>(initial.status ?? "available");
  // First letter (A–Z series): "all" or A..Z.
  const [letter, setLetter] = useState<string>(initial.letter ?? "all");
  const [form, setForm] = useState<{ open: boolean; editing: NameRow | null }>({ open: false, editing: null });
  const [bulk, setBulk] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState<NameRow | null>(null);
  const [suggest, setSuggest] = useState(false);
  const [sg, setSg] = useState<{ gender: Gender; style: NameStyle }>({ gender: "girl", style: "two-word" });
  const [confirmRejectAll, setConfirmRejectAll] = useState(false);
  const existing = useMemo(() => new Set(names.map((n) => nameKey(n.name))), [names]);
  // AI suggestions waiting for approval. The Pending filter only appears while there are some
  // (or while it is selected), so the usual four-option row stays short on a phone.
  const pendingCount = useMemo(() => names.filter((n) => n.status === "pending").length, [names]);
  const statusOptions: { value: "all" | NameStatus; label: string }[] = [
    { value: "available", label: "Available" },
    ...(pendingCount > 0 || status === "pending" ? [{ value: "pending" as const, label: `Pending · ${pendingCount}` }] : []),
    { value: "used", label: "Used" }, { value: "skip", label: "Skip" }, { value: "all", label: "All" },
  ];

  const shown = useMemo(() => names.filter((n) =>
    (gender === "all" || n.gender === gender) && (style === "all" || n.style === style) && (status === "all" || n.status === status) &&
    (letter === "all" || letterOf(n.name) === letter) &&
    (!q || n.name.toLowerCase().includes(q.toLowerCase()) || n.meaning.toLowerCase().includes(q.toLowerCase())),
  ).sort((a, b) => a.name.localeCompare(b.name)), [names, q, gender, style, status, letter]);

  // Optimistic row change: `next` (or null = removed) shows at once; a failure puts the row back.
  const act = async (n: NameRow, next: NameRow | null, fn: () => Promise<ActionResult>, ok: string) => {
    if (busy.has(n.id)) return;
    setBusy((b) => new Set(b).add(n.id));
    const r = await optimistic(
      () => setNames((list) => (next ? list.map((x) => (x.id === n.id ? next : x)) : list.filter((x) => x.id !== n.id))),
      () => setNames((list) => (list.some((x) => x.id === n.id) ? list.map((x) => (x.id === n.id ? n : x)) : [...list, n])),
      fn);
    setBusy((b) => { const s = new Set(b); s.delete(n.id); return s; });
    if (r.ok) toast.success(ok); else toast.error(r.error);
  };

  // Approve/reject pending suggestions, one or many: the rows change at once, a failure puts them back.
  const decide = async (rows: NameRow[], approve: boolean) => {
    const list = rows.filter((n) => n.status === "pending" && !busy.has(n.id));
    if (!list.length) return;
    const ids = new Set(list.map((n) => n.id));
    setBusy((b) => new Set([...b, ...ids]));
    const r = await optimistic(
      () => setNames((all) => (approve ? all.map((x) => (ids.has(x.id) ? { ...x, status: "available" as const } : x)) : all.filter((x) => !ids.has(x.id)))),
      // A bulk call that stopped part-way keeps the rows it already changed; only the rest go back.
      (fail) => { const done = doneIds(fail); const back = list.filter((n) => !done.has(n.id)); const undo = new Set(back.map((n) => n.id));
        setNames((all) => [...all.filter((x) => !undo.has(x.id)), ...back]); },
      () => (approve ? approveNamesAction([...ids]) : rejectNamesAction([...ids])));
    setBusy((b) => { const s = new Set(b); ids.forEach((id) => s.delete(id)); return s; });
    const one = list.length === 1 ? list[0].name : `${list.length} names`;
    if (r.ok) toast.success(approve ? `${one} approved` : `${one} rejected`); else toast.error(r.error);
  };
  const pendingShown = status === "pending" ? shown.filter((n) => n.status === "pending") : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setForm({ open: true, editing: null })}><Plus className="size-4" /> Add name</Button>
        <Button variant="subtle" onClick={() => setBulk(true)}><ClipboardPaste className="size-4" /> Paste many</Button>
        <Button variant="subtle" onClick={() => setSuggest(true)}><Sparkles className="size-4" aria-hidden /> Suggest with AI</Button>
      </div>
      {pendingCount > 0 && status !== "pending" && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent/40 bg-accent-soft px-4 py-2">
          <p className="text-sm text-ink"><span className="font-semibold">Pending approval ({pendingCount})</span> · AI suggestions are not used in posts until you approve them.</p>
          <Button size="sm" onClick={() => setStatus("pending")}>Review</Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <span className="sr-only">Search names</span>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names or meanings" className="bg-surface pl-9 pr-3" />
        </label>
        <Segmented label="Gender" value={gender} onChange={setGender} options={[{ value: "all", label: "All" }, { value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }]} />
        <Segmented label="Style" value={style} onChange={setStyle} options={[{ value: "all", label: "Any" }, { value: "two-word", label: "Two-word" }, { value: "single", label: "Single" }]} />
        <Segmented label="Status" value={status} onChange={setStatus} options={statusOptions} />
        <Select value={letter} onValueChange={setLetter}>
          <SelectTrigger aria-label="First letter" className="min-h-11 w-auto min-w-28 bg-surface font-semibold">
            <SelectValue>{letter === "all" ? "Any letter" : `Starts with ${letter}`}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" collisionPadding={{ top: 8, bottom: 80 }} className="max-h-[min(20rem,var(--radix-select-content-available-height))]">
            <SelectItem value="all">Any letter</SelectItem>
            {AZ_LETTERS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted">{shown.length} of {names.length} names</p>
      {pendingShown.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-2">
          <p className="mr-auto text-sm text-muted">Approve the names you like; rejected ones are deleted. Edit a name first to fix it.</p>
          <Button size="sm" onClick={() => void decide(pendingShown, true)}><Check className="size-4" aria-hidden /> Approve all ({pendingShown.length})</Button>
          <Button size="sm" variant="danger" onClick={() => setConfirmRejectAll(true)}><X className="size-4" aria-hidden /> Reject all</Button>
        </div>
      )}

      {shown.length === 0 ? (
        <Empty icon={<Type className="size-6" />} title="No names here" text={names.length ? "Nothing matches these filters." : "Add your first names, or paste a list."}
          action={<Button variant="subtle" onClick={() => setBulk(true)}><ClipboardPaste className="size-4" /> Paste many</Button>} />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {shown.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                <div className="break-words font-semibold text-ink">{n.name}</div>
                <div className="break-words text-sm text-muted">{n.meaning}</div>
              </div>
              <Badge tone="muted">{n.gender === "boy" ? "Boy" : "Girl"} · {n.style}</Badge>
              <Badge tone={STATUS_TONE[n.status]}>{STATUS_TEXT[n.status]}</Badge>
              <div className="ml-auto flex gap-1">
                {n.status === "pending" && (
                  <>
                    <Button variant="ghost" size="icon" disabled={busy.has(n.id)} aria-label={`Approve ${n.name}`} onClick={() => void decide([n], true)}><Check className="size-4 text-ok" /></Button>
                    <Button variant="ghost" size="icon" disabled={busy.has(n.id)} aria-label={`Edit ${n.name}`} onClick={() => setForm({ open: true, editing: n })}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon" disabled={busy.has(n.id)} aria-label={`Reject ${n.name}`} onClick={() => void decide([n], false)}><X className="size-4 text-bad" /></Button>
                  </>
                )}
                {(n.status === "available" || n.status === "skip") && (
                  <>
                    <Button variant="ghost" size="icon" disabled={busy.has(n.id)} aria-label={`Edit ${n.name}`} onClick={() => setForm({ open: true, editing: n })}><Pencil className="size-4" /></Button>
                    {n.status === "available"
                      ? <Button variant="ghost" size="icon" disabled={busy.has(n.id)} aria-label={`Skip ${n.name}`} onClick={() => act(n, { ...n, status: "skip" }, () => setSkipAction(n.id, true), `${n.name} will be skipped`)}><Ban className="size-4" /></Button>
                      : n.status === "skip" && <Button variant="ghost" size="icon" disabled={busy.has(n.id)} aria-label={`Use ${n.name} again`} onClick={() => act(n, { ...n, status: "available" }, () => setSkipAction(n.id, false), `${n.name} is available again`)}><Undo2 className="size-4" /></Button>}
                    <Button variant="ghost" size="icon" disabled={busy.has(n.id)} aria-label={`Delete ${n.name}`} onClick={() => setConfirmDel(n)}><Trash2 className="size-4 text-bad" /></Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!confirmDel} onOpenChange={(o) => { if (!o) setConfirmDel(null); }} title={`Delete ${confirmDel?.name ?? ""}?`} description="This can't be undone. Mark it Skip instead to keep it out of posts.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button>
          <Button variant="danger"
            onClick={() => { const d = confirmDel; if (!d) return; setConfirmDel(null); void act(d, null, () => deleteNameAction(d.id), `Deleted ${d.name}`); }}>Delete</Button>
        </div>
      </Dialog>
      <Dialog open={confirmRejectAll} onOpenChange={setConfirmRejectAll} title={`Reject ${pendingShown.length} suggested names?`} description="They are deleted from your list. This can't be undone.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmRejectAll(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => { setConfirmRejectAll(false); void decide(pendingShown, false); }}>Reject all</Button>
        </div>
      </Dialog>
      <SuggestDialog open={suggest} onOpenChange={setSuggest} noun="name" title="Suggest names with AI"
        description="Gemini suggests new names with meanings. Names already in your list are skipped; the rest wait for your approval."
        range={NAME_COUNT} defaultCount={10} ideaPlaceholder="e.g. nature names, soft sounds, Greek myths"
        fields={<div className="flex flex-wrap gap-2">
          <Segmented label="Gender" value={sg.gender} onChange={(g) => setSg((x) => ({ ...x, gender: g }))} options={[{ value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }]} />
          <Segmented label="Style" value={sg.style} onChange={(st) => setSg((x) => ({ ...x, style: st }))} options={[{ value: "two-word", label: "Two-word" }, { value: "single", label: "Single" }]} />
        </div>}
        run={(count, vibe) => suggestNamesAction({ ...sg, count, vibe })}
        onReview={() => { setStatus("pending"); setGender(sg.gender); setStyle(sg.style); setQ(""); }} />
      {/* add/edit/paste actions revalidate /names, which re-renders this list in the same response */}
      <NameForm open={form.open} editing={form.editing} defaultGender={gender === "girl" ? "girl" : "boy"} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))} onSaved={() => {}} />
      <BulkPaste open={bulk} onOpenChange={setBulk} existing={existing} onSaved={() => {}} />
    </div>
  );
}
