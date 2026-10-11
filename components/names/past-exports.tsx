"use client";
import { useState } from "react";
import { Copy, Eye, FileText } from "lucide-react";
import { toast } from "sonner";
import type { ExportLogRow } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { revealExportPasswordAction } from "@/lib/actions/names-pdf";
import { callAction } from "@/lib/actions/call";

// Names > Past exports: every names PDF made (migration 018), newest first: buyer, date, pick, size, file name, and
// its password on demand (to send it to the buyer again). `exports` null = the log does not exist yet (before 018).

const PICK: Record<ExportLogRow["gender"], string> = { girl: "Girl", boy: "Boy", both: "Girl & Boy" };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function PastExports({ exports }: { exports: ExportLogRow[] | null }) {
  const [shown, setShown] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const reveal = async (id: string) => {
    setBusy(id);
    const r = await callAction(() => revealExportPasswordAction(id));
    setBusy(null);
    if (r.ok) setShown((s) => ({ ...s, [id]: r.password }));
    else toast.error(r.error);
  };
  const copy = async (pw: string) => {
    try { await navigator.clipboard.writeText(pw); toast.success("Password copied"); } catch { toast.error("Could not copy. Select the password and copy it by hand."); }
  };

  return (
    <Disclosure className="rounded-2xl border border-line bg-surface px-4 py-1" summary={<span className="flex items-center gap-2 text-sm"><FileText className="size-4 text-muted" aria-hidden /> Past exports{exports ? ` (${exports.length})` : ""}</span>}>
      {exports === null ? (
        <p className="pb-3 text-sm text-muted">Run <code>supabase/migrations/018_names_pdf.sql</code> to keep a log of every PDF and its password here.</p>
      ) : exports.length === 0 ? (
        <p className="pb-3 text-sm text-muted">No PDFs yet. Use Export PDF to make the first one.</p>
      ) : (
        <ul className="divide-y divide-line pb-2">
          {exports.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                <div className="break-words font-semibold text-ink">{e.buyer}</div>
                <div className="break-words text-xs text-muted">{when(e.created_at)} · {PICK[e.gender]} · {e.name_count} names · {e.file_name}</div>
              </div>
              {shown[e.id] ? (
                <div className="flex items-center gap-1">
                  <span className="select-all font-mono text-sm font-semibold text-ink" aria-label={`Password for ${e.buyer}`}>{shown[e.id]}</span>
                  <Button variant="ghost" size="icon" aria-label={`Copy the password for ${e.buyer}`} onClick={() => void copy(shown[e.id])}><Copy className="size-4" /></Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" loading={busy === e.id} onClick={() => void reveal(e.id)} aria-label={`Show the password for ${e.buyer}`}><Eye className="size-4" aria-hidden /> Show password</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Disclosure>
  );
}
