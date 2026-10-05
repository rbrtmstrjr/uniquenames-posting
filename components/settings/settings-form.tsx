"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, LogOut } from "lucide-react";
import { TEXT_SETTINGS_DEFAULTS, type SettingsRow } from "@/lib/db/types";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/shadcn/input";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { Switch } from "@/components/ui/shadcn/switch";
import { Slider } from "@/components/ui/shadcn/slider";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { saveSettingsAction } from "@/lib/actions/settings";
import { callAction } from "@/lib/actions/call";
import { validateSettings } from "@/lib/actions/validate";
import { buildCaption } from "@/lib/planner";
import { createClient } from "@/lib/supabase/client";

// Card counts are picked on sliders, so a value is always a whole number in range;
// validateSettings still rejects "fewest" above "most" with a clear message.
const COUNT_MIN = 1;
const COUNT_MAX = 30;

export function SettingsForm({ initial }: { initial: SettingsRow }) {
  const router = useRouter();
  const [s, setS] = useState({ caption_template: initial.caption_template, hashtags: initial.hashtags, handle: initial.handle, min_images: initial.min_images, max_images: initial.max_images, sound_on: initial.sound_on,
    // undefined until migration 002 runs: the column default (on) is what the app uses then.
    caption_ai: initial.caption_ai ?? TEXT_SETTINGS_DEFAULTS.caption_ai });
  const [busy, setBusy] = useState(false);
  const problem = validateSettings(s);

  const save = async () => {
    if (validateSettings(s)) return;
    setBusy(true);
    // The form already shows the new values; the action's revalidatePath refreshes the
    // layout (chime setting) in the same response, so no extra router.refresh() round trip.
    const r = await callAction(() => saveSettingsAction(s));
    setBusy(false);
    if (r.ok) toast.success("Settings saved"); else toast.error(r.error);
  };
  const enableNotifications = async () => {
    // Undefined on iOS Safari outside a home-screen app.
    if (typeof Notification === "undefined") { toast.error("This browser can't show notifications"); return; }
    const p = await Notification.requestPermission();
    if (p === "granted") toast.success("You will get a notification when a post is ready.");
    else toast.error("Notifications are blocked in this browser.");
  };
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => { setSigningOut(true); await createClient().auth.signOut(); router.replace("/login"); };

  return (
    <div className="space-y-4">
      <Panel title="Caption">
        <div className="space-y-3">
          <div>
            <label htmlFor="caption-ai" className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
              <Switch id="caption-ai" checked={s.caption_ai} onCheckedChange={(v) => setS({ ...s, caption_ai: v })} /> Write captions with AI
            </label>
            <p className="text-xs text-muted">{s.caption_ai
              ? "Each new post gets its own 1–2 sentences about its theme, then your hashtags. The fallback caption below is used if AI is unavailable."
              : "New posts use the fallback caption below. You can still tap Rewrite caption on a post."}</p>
          </div>
          <label className="block"><span className="text-xs font-semibold text-muted">Fallback caption ({"{gender}"} becomes boy or girl)</span>
            <Textarea value={s.caption_template} onChange={(e) => setS({ ...s, caption_template: e.target.value })} rows={2} className="mt-1" /></label>
          <label className="block"><span className="text-xs font-semibold text-muted">Hashtags</span>
            <Input value={s.hashtags} onChange={(e) => setS({ ...s, hashtags: e.target.value })} className="mt-1" /></label>
          <div className="rounded-xl bg-surface-2 p-3 text-sm whitespace-pre-wrap text-ink"><span className="mb-1 block text-xs font-semibold text-muted">Fallback preview</span>{buildCaption("girl", s)}</div>
        </div>
      </Panel>
      <Panel title="Cards">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block"><span className="text-xs font-semibold text-muted">Watermark handle</span>
            <Input value={s.handle} onChange={(e) => setS({ ...s, handle: e.target.value })} className="mt-1" /></label>
          <CountSlider label="Fewest cards (Auto)" value={s.min_images} onChange={(v) => setS({ ...s, min_images: v })} />
          <CountSlider label="Most cards (Auto)" value={s.max_images} onChange={(v) => setS({ ...s, max_images: v })} />
        </div>
        <p className="mt-2 text-xs text-muted">The handle change applies to cards made from now on.</p>
      </Panel>
      <Panel title="App">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="sound-on" className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
            <Switch id="sound-on" checked={s.sound_on} onCheckedChange={(v) => setS({ ...s, sound_on: v })} /> Chime when a post is ready
          </label>
          <Button variant="subtle" size="sm" onClick={enableNotifications}><Bell className="size-4" aria-hidden /> Allow notifications</Button>
          <ThemeToggle />
        </div>
      </Panel>
      {problem && <p role="alert" className="rounded-xl border border-bad bg-bad/10 p-3 text-sm font-semibold text-ink">{problem}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button onClick={save} loading={busy} disabled={!!problem}>Save settings</Button>
        <Button variant="ghost" loading={signingOut} onClick={signOut}><LogOut className="size-4" aria-hidden /> Sign out</Button>
      </div>
    </div>
  );
}

function CountSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-muted">{label}</span>
        <span className="text-sm font-bold tabular-nums text-ink" aria-hidden>{value}</span>
      </div>
      <Slider aria-label={label} min={COUNT_MIN} max={COUNT_MAX} step={1} value={[value]} onValueChange={([v]) => onChange(v)} className="mt-1" />
    </div>
  );
}
