"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, FileDown, KeyRound } from "lucide-react";
import { toast } from "sonner";
import type { NameRow } from "@/lib/db/types";
import type { PdfGender } from "@/packs/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Input } from "@/components/ui/shadcn/input";
import { sortNamesAction } from "@/lib/actions/names-pdf";
import { OFFLINE_ERROR, callAction } from "@/lib/actions/call";
import { isMeaningCategory } from "@/lib/names/categories";
import { pdfGenders, previewCounts, sellable } from "@/lib/pdf/plan";

// Names > Export PDF: the buyer and the girl / boy pick, a preview of what goes in, then "Create PDF": the names
// without a meaning group are sorted first (a round at a time, with progress), the PDF is made on the server
// (POST /names/export) and downloaded, and its NEW password is shown once with a Copy button.

const MAX_SORT_ROUNDS = 40;

type Done = { password: string; fileName: string; count: number; pages: number; logged: boolean; warning: string | null; blob: Blob };

/** Save a file in the browser. */
function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function ExportPdf({ names, canSort }: { names: NameRow[]; canSort: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [buyer, setBuyer] = useState("");
  const [gender, setGender] = useState<PdfGender>("girl");
  const [phase, setPhase] = useState<"form" | "sorting" | "making">("form");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [copied, setCopied] = useState(false);
  const running = useRef(false);

  const counts = useMemo(() => previewCounts(names), [names]);
  const picked = pdfGenders(gender);
  const total = picked.reduce((s, g) => s + counts[g].single + counts[g]["two-word"], 0);
  const unsorted = useMemo(() => (canSort ? names.filter((n) => sellable(n) && !isMeaningCategory(n.meaning_category)).length : 0), [names, canSort]);
  const busy = phase !== "form";
  const buyerOk = buyer.trim().length >= 2;

  const close = (o: boolean) => {
    if (busy) return;
    setOpen(o);
    if (!o) { setDone(null); setError(null); setProgress(null); setCopied(false); setBuyer(""); }
  };

  const create = async () => {
    if (running.current || !buyerOk || !total) return;
    running.current = true;
    setError(null);
    try {
      if (unsorted > 0) {
        setPhase("sorting");
        let sorted = 0;
        setProgress({ done: 0, total: unsorted });
        for (let round = 0; round < MAX_SORT_ROUNDS; round++) {
          const r = await callAction(() => sortNamesAction());
          if (!r.ok) { setError(`Sorting names by meaning stopped: ${r.error}`); return; }
          if (r.needs018) break;
          sorted += r.sorted;
          setProgress({ done: sorted, total: sorted + r.remaining });
          if (r.remaining === 0 || r.sorted === 0) break;
        }
      }
      setPhase("making");
      let res: Response;
      try {
        res = await fetch("/names/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buyer: buyer.trim(), gender }) });
      } catch {
        setError(OFFLINE_ERROR);
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "Could not make the PDF. Try again.");
        return;
      }
      const blob = await res.blob();
      const h = (k: string) => res.headers.get(k) ?? "";
      const fileName = h("X-Export-File") || "names.pdf";
      const warning = h("X-Export-Warning") ? decodeURIComponent(h("X-Export-Warning")) : null;
      setDone({ password: h("X-Export-Password"), fileName, count: Number(h("X-Export-Count")) || total, pages: Number(h("X-Export-Pages")) || 0, logged: h("X-Export-Logged") === "1", warning, blob });
      saveBlob(blob, fileName);
      router.refresh();
    } finally {
      running.current = false;
      setPhase("form");
    }
  };

  const copy = async (password: string) => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      toast.success("Password copied");
    } catch {
      toast.error("Could not copy. Select the password and copy it by hand.");
    }
  };

  const part = (label: string, n: number) => <span className="rounded-lg bg-surface-2 px-2.5 py-1">{label} <b className="text-ink">{n}</b></span>;

  return (
    <>
      <Button variant="subtle" onClick={() => setOpen(true)}><FileDown className="size-4" aria-hidden /> Export PDF</Button>
      <Dialog open={open} onOpenChange={close} title={done ? "Your PDF is ready" : "Export names as a PDF"}
        description={done ? undefined : "A lovely, password-protected list of your approved names to sell. Every download gets its own new password."}>
        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-muted"><span className="font-semibold text-ink">{done.fileName}</span><br />{done.count} names{done.pages ? ` · ${done.pages} pages` : ""}. Saved to your downloads.</p>
            <div className="rounded-2xl border border-accent/40 bg-accent-soft p-4">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.08em] text-accent"><KeyRound className="size-4" aria-hidden /> Password for this PDF</p>
              <p className="mt-2 select-all break-all font-mono text-2xl font-semibold tracking-wider text-ink" aria-label="PDF password">{done.password}</p>
              <p className="mt-2 text-xs text-muted">
                Shown once. Send it to the buyer separately from the file.{done.logged ? " It is also kept in Past exports." : ""}
              </p>
            </div>
            {done.warning && <p role="alert" className="rounded-xl bg-warn/15 px-3 py-2 text-sm text-warn-text">{done.warning}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => saveBlob(done.blob, done.fileName)}><Download className="size-4" aria-hidden /> Download again</Button>
              <Button onClick={() => void copy(done.password)}>{copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} Copy password</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block"><span className="text-xs font-semibold text-muted">Buyer&apos;s name or email (printed on every page)</span>
              <Input value={buyer} onChange={(e) => setBuyer(e.target.value)} maxLength={120} placeholder="e.g. Maria Santos or maria@email.com" className="mt-1" disabled={busy} /></label>
            <div>
              <span className="mb-1 block text-xs font-semibold text-muted">Names for</span>
              <Segmented label="Names for" fill value={gender} onChange={setGender}
                options={[{ value: "girl", label: "Girl" }, { value: "boy", label: "Boy" }, { value: "both", label: "Both" }]} />
            </div>
            <div className="space-y-2 text-sm text-muted" aria-label="What goes in">
              {picked.map((g) => (
                <div key={g} className="flex flex-wrap items-center gap-2">
                  <span className="w-12 font-semibold text-ink">{g === "girl" ? "Girl" : "Boy"}</span>
                  {part("Single", counts[g].single)}{part("Combo", counts[g]["two-word"])}
                </div>
              ))}
              <p>{total} names in all, single names first, then combos, grouped by meaning, A to Z.</p>
              {unsorted > 0 && <p className="text-xs">{unsorted} names are not sorted by meaning yet; the AI sorts them first (once).</p>}
            </div>
            {phase === "sorting" && progress && (
              <div role="status" className="space-y-1">
                <p className="text-sm text-ink">Sorting names by meaning… {progress.done} of {progress.total}</p>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
              </div>
            )}
            {phase === "making" && <p role="status" className="text-sm text-ink">Making your PDF…</p>}
            {error && <p role="alert" className="rounded-xl bg-bad/12 px-3 py-2 text-sm text-bad">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => close(false)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void create()} loading={busy} disabled={!buyerOk || !total}><FileDown className="size-4" aria-hidden /> Create PDF</Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
