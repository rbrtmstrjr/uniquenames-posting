"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, LogOut } from "lucide-react";
import type { SettingsRow } from "@/lib/db/types";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { saveSettingsAction } from "@/lib/actions/settings";
import { validateSettings } from "@/lib/actions/validate";
import { buildCaption } from "@/lib/planner";
import { createClient } from "@/lib/supabase/client";

const FIELD = "mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm text-ink";

// A cleared number input becomes NaN, which validateSettings rejects with a clear message.
const toCount = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));
const fromCount = (n: number) => (Number.isNaN(n) ? "" : n);

export function SettingsForm({ initial }: { initial: SettingsRow }) {
  const router = useRouter();
  const [s, setS] = useState({ caption_template: initial.caption_template, hashtags: initial.hashtags, handle: initial.handle, min_images: initial.min_images, max_images: initial.max_images, sound_on: initial.sound_on });
  const [busy, setBusy] = useState(false);
  const problem = validateSettings(s);

  const save = async () => {
    if (validateSettings(s)) return;
    setBusy(true);
    try {
      const r = await saveSettingsAction(s);
      if (r.ok) { toast.success("Settings saved"); router.refresh(); } else toast.error(r.error);
    } catch {
      toast.error("Could not save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const enableNotifications = async () => {
    // Undefined on iOS Safari outside a home-screen app.
    if (typeof Notification === "undefined") { toast.error("This browser can't show notifications"); return; }
    const p = await Notification.requestPermission();
    if (p === "granted") toast.success("You will get a notification when a post is ready.");
    else toast.error("Notifications are blocked in this browser.");
  };
  const signOut = async () => { await createClient().auth.signOut(); router.replace("/login"); };

  return (
    <div className="space-y-4">
      <Panel title="Caption">
        <div className="space-y-3">
          <label className="block"><span className="text-xs font-semibold text-muted">Caption template ({"{gender}"} becomes boy or girl)</span>
            <textarea value={s.caption_template} onChange={(e) => setS({ ...s, caption_template: e.target.value })} rows={2} className="mt-1 w-full rounded-xl border border-line bg-bg p-3 text-sm text-ink" /></label>
          <label className="block"><span className="text-xs font-semibold text-muted">Hashtags</span>
            <input value={s.hashtags} onChange={(e) => setS({ ...s, hashtags: e.target.value })} className={FIELD} /></label>
          <div className="rounded-xl bg-surface-2 p-3 text-sm whitespace-pre-wrap text-ink"><span className="mb-1 block text-xs font-semibold text-muted">Preview</span>{buildCaption("girl", s)}</div>
        </div>
      </Panel>
      <Panel title="Cards">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="text-xs font-semibold text-muted">Watermark handle</span>
            <input value={s.handle} onChange={(e) => setS({ ...s, handle: e.target.value })} className={FIELD} /></label>
          <label className="block"><span className="text-xs font-semibold text-muted">Fewest cards (Auto)</span>
            <input type="number" inputMode="numeric" min={1} max={30} value={fromCount(s.min_images)} onChange={(e) => setS({ ...s, min_images: toCount(e.target.value) })} className={FIELD} /></label>
          <label className="block"><span className="text-xs font-semibold text-muted">Most cards (Auto)</span>
            <input type="number" inputMode="numeric" min={1} max={30} value={fromCount(s.max_images)} onChange={(e) => setS({ ...s, max_images: toCount(e.target.value) })} className={FIELD} /></label>
        </div>
        <p className="mt-2 text-xs text-muted">The handle change applies to cards made from now on.</p>
      </Panel>
      <Panel title="App">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
            <input type="checkbox" checked={s.sound_on} onChange={(e) => setS({ ...s, sound_on: e.target.checked })} className="size-6 shrink-0 accent-[var(--accent)]" /> Chime when a post is ready
          </label>
          <Button variant="subtle" size="sm" onClick={enableNotifications}><Bell className="size-4" aria-hidden /> Allow notifications</Button>
          <ThemeToggle />
        </div>
      </Panel>
      {problem && <p role="alert" className="rounded-xl border border-bad bg-bad/10 p-3 text-sm font-semibold text-ink">{problem}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button onClick={save} loading={busy} disabled={!!problem}>Save settings</Button>
        <Button variant="ghost" onClick={signOut}><LogOut className="size-4" aria-hidden /> Sign out</Button>
      </div>
    </div>
  );
}
