"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usCheckApplyAction, usCheckPreviewAction } from "@/lib/actions/names";
import { callAction } from "@/lib/actions/call";

type Step = { kind: "idle" } | { kind: "confirm"; skip: number; checked: number } | { kind: "done"; text: string };

/** One press checks every available name against the US list; the owner confirms before anything is skipped. */
export function UsCheck() {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    const r = await callAction(() => usCheckPreviewAction());
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    setStep(r.skip === 0 ? { kind: "done", text: "Every available name is a US name." } : { kind: "confirm", skip: r.skip, checked: r.checked });
  };
  const apply = async () => {
    setBusy(true);
    const r = await callAction(() => usCheckApplyAction());
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    setStep({ kind: "done", text: `${r.skipped} names skipped.` });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-2">
      {step.kind === "confirm" ? (
        <>
          <p role="status" className="mr-auto text-sm text-ink">{step.skip} names aren&apos;t US names ({step.checked} checked). Skip them?</p>
          <Button size="sm" onClick={apply} loading={busy}>Skip them</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStep({ kind: "idle" })}>Cancel</Button>
        </>
      ) : (
        <>
          <p className="mr-auto text-sm text-muted">{step.kind === "done" ? step.text : "Names aim at the US, Canada, the UK and Australia. Skipped names can be brought back."}</p>
          <Button size="sm" variant="subtle" onClick={check} loading={busy}>Check names against the US list</Button>
        </>
      )}
    </div>
  );
}
