"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { callAction } from "@/lib/actions/call";
import { saveNameThemesAction } from "@/lib/actions/autopilot";
import { nameThemesProblem } from "@/lib/autopilot/name-themes";

export function NameThemesEditor({ text }: { text: string }) {
  const router = useRouter();
  const [value, setValue] = useState(text);
  const [saving, setSaving] = useState(false);
  const problem = nameThemesProblem(value);
  const save = async () => {
    setSaving(true);
    const r = await callAction(() => saveNameThemesAction(value));
    setSaving(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("Name themes saved.");
    router.refresh();
  };
  return (
    <Panel title="Name themes">
      <p className="text-sm text-muted">After Z, Autopilot goes through these, one per day, then back to A. One per line, in order. A hint in brackets helps the AI: Heavenly (stars, sky, light).</p>
      <label htmlFor="ap-themes" className="sr-only">Name themes</label>
      <textarea id="ap-themes" value={value} onChange={(e) => setValue(e.target.value)} rows={10}
        className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
      {problem && <p className="text-xs text-bad" role="status">{problem}</p>}
      <Button className="mt-2" onClick={() => void save()} loading={saving} disabled={!!problem || value === text}>Save name themes</Button>
    </Panel>
  );
}
