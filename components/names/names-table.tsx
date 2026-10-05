"use client";
import { useMemo, useState } from "react";
import { Ban, ClipboardPaste, Pencil, Plus, Search, Trash2, Undo2, Type } from "lucide-react";
import { toast } from "sonner";
import type { Gender, NameRow, NameStatus, NameStyle } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/segmented";
import { deleteNameAction, setSkipAction } from "@/lib/actions/names";
import { optimistic } from "@/lib/actions/call";
import type { ActionResult } from "@/lib/actions/result";
import { nameKey } from "@/lib/actions/helpers";
import { Dialog } from "@/components/ui/dialog";
import { NameForm } from "./name-form";
import { BulkPaste } from "./bulk-paste";

const STATUS_TONE: Record<NameStatus, "ok" | "accent" | "muted" | "warn"> = { available: "ok", reserved: "accent", used: "muted", skip: "warn" };
const STATUS_TEXT: Record<NameStatus, string> = { available: "Available", reserved: "In a post", used: "Used", skip: "Skip" };

export function NamesTable({ names: serverNames }: { names: NameRow[] }) {
  // Local copy for optimistic updates; re-seeded whenever the server sends fresh rows
  // (each action's revalidatePath re-renders this page in the same response).
  const [names, setNames] = useState(serverNames);
  const [seed, setSeed] = useState(serverNames);
  if (seed !== serverNames) { setSeed(serverNames); setNames(serverNames); }
  const [q, setQ] = useState("");
  const [gender, setGender] = useState<"all" | Gender>("all");
  const [style, setStyle] = useState<"all" | NameStyle>("all");
  const [status, setStatus] = useState<"all" | NameStatus>("available");
  const [form, setForm] = useState<{ open: boolean; editing: NameRow | null }>({ open: false, editing: null });
  const [bulk, setBulk] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState<NameRow | null>(null);
  const existing = useMemo(() => new Set(names.map((n) => nameKey(n.name))), [names]);

  const shown = useMemo(() => names.filter((n) =>
    (gender === "all" || n.gender === gender) && (style === "all" || n.style === style) && (status === "all" || n.status === status) &&
    (!q || n.name.toLowerCase().includes(q.toLowerCase()) || n.meaning.toLowerCase().includes(q.toLowerCase())),
  ).sort((a, b) => a.name.localeCompare(b.name)), [names, q, gender, style, status]);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setForm({ open: true, editing: null })}><Plus className="size-4" /> Add name</Button>
        <Button variant="subtle" onClick={() => setBulk(true)}><ClipboardPaste className="size-4" /> Paste many</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <span className="sr-only">Search names</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names or meanings" className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink" />
        </label>
        <Segmented label="Gender" value={gender} onChange={setGender} options={[{ value: "all", label: "All" }, { value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }]} />
        <Segmented label="Style" value={style} onChange={setStyle} options={[{ value: "all", label: "Any" }, { value: "two-word", label: "Two-word" }, { value: "single", label: "Single" }]} />
        <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: "available", label: "Available" }, { value: "used", label: "Used" }, { value: "skip", label: "Skip" }, { value: "all", label: "All" }]} />
      </div>
      <p className="text-xs text-muted">{shown.length} of {names.length} names</p>

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
                {(n.status === "available" || n.status === "skip") && (
                  <>
                    <Button variant="ghost" size="icon" disabled={busy.has(n.id)} aria-label={`Edit ${n.name}`} onClick={() => setForm({ open: true, editing: n })}><Pencil className="size-4" /></Button>
                    {n.status === "available"
                      ? <Button variant="ghost" size="icon" disabled={busy.has(n.id)} aria-label={`Skip ${n.name}`} onClick={() => act(n, { ...n, status: "skip" }, () => setSkipAction(n.id, true), `${n.name} will be skipped`)}><Ban className="size-4" /></Button>
                      : <Button variant="ghost" size="icon" disabled={busy.has(n.id)} aria-label={`Use ${n.name} again`} onClick={() => act(n, { ...n, status: "available" }, () => setSkipAction(n.id, false), `${n.name} is available again`)}><Undo2 className="size-4" /></Button>}
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
      {/* add/edit/paste actions revalidate /names, which re-renders this list in the same response */}
      <NameForm open={form.open} editing={form.editing} defaultGender={gender === "girl" ? "girl" : "boy"} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))} onSaved={() => {}} />
      <BulkPaste open={bulk} onOpenChange={setBulk} existing={existing} onSaved={() => {}} />
    </div>
  );
}
