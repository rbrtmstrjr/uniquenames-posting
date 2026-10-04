"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Panel } from "@/components/ui/panel";
import { useHotkey } from "@/lib/realtime/hotkey";
import { createPostAction } from "@/lib/actions/posts";
import type { Gender, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { useWorkerContext } from "@/components/shell/app-shell";
import { PC_TEXT } from "@/components/shell/pc-status";

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

export function NewPostPanel({ settings, themes, stock, busy }: {
  settings: SettingsRow; themes: ThemeRow[]; stock: { gender: Gender; style: NameStyle; count: number }[]; busy: boolean;
}) {
  const router = useRouter();
  const { health } = useWorkerContext();
  const [gender, setGender] = useState<Gender>("boy");
  const [style, setStyle] = useState<NameStyle>("two-word");
  const [count, setCount] = useState<string>("auto");
  const [date, setDate] = useState(manilaToday);
  const [themeId, setThemeId] = useState<string>("");
  const [pending, start] = useTransition();

  const genderThemes = useMemo(() => themes.filter((t) => t.gender === gender), [themes, gender]);
  const theme = genderThemes.find((t) => t.id === themeId) ?? genderThemes[0];
  const left = stock.find((s) => s.gender === gender && s.style === style)?.count ?? 0;
  const counts = Array.from({ length: settings.max_images - settings.min_images + 1 }, (_, i) => String(settings.min_images + i));
  const blocked = left < settings.min_images ? `Only ${left} ${gender} ${style} names left. Add names first.` : !theme ? `No ${gender} theme left. Add a theme first.` : null;

  const generate = () => {
    if (blocked || pending) return;
    start(async () => {
      const r = await createPostAction({ gender, style, count: count === "auto" ? null : Number(count), postDate: date, themeId: theme?.id, requestId: crypto.randomUUID() });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(health === "ready" ? "Post queued. Cards will appear as they are made." : `Post queued. ${PC_TEXT[health].fix}`);
      router.refresh();
    });
  };
  useHotkey("g", generate);

  return (
    <Panel title={`New post · ${new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Segmented label="Gender" value={gender} onChange={(v) => { setGender(v); setThemeId(""); }} options={[{ value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }]} />
          <Segmented label="Name style" value={style} onChange={setStyle} options={[{ value: "two-word", label: "Two-word" }, { value: "single", label: "Single" }]} />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted">Cards</div>
          <Segmented label="Number of cards" value={count} onChange={setCount}
            options={[{ value: "auto", label: `Auto ${settings.min_images}–${settings.max_images}` }, ...counts.map((c) => ({ value: c, label: c }))]} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="mb-1.5 flex items-center justify-between gap-1.5 text-xs font-semibold text-muted">
              <span className="flex items-center gap-1.5"><Palette className="size-3.5" /> Theme</span>
              <Link href="/themes" className="text-accent hover:underline">Preview / change order</Link>
            </span>
            <select value={theme?.id ?? ""} onChange={(e) => setThemeId(e.target.value)} disabled={!genderThemes.length}
              className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm font-semibold text-ink">
              {genderThemes.map((t, i) => <option key={t.id} value={t.id}>{i === 0 ? `${t.title} (next)` : t.title}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">Post date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-xl border border-line bg-bg px-3 text-sm text-ink" />
          </label>
        </div>
        {theme && <p className="text-xs text-muted">{theme.backdrop} · {theme.outfit} · {theme.props}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={generate} loading={pending} disabled={!!blocked} className="w-full sm:w-auto">
            <Sparkles className="size-4" /> Generate post
          </Button>
          <span className="text-xs text-muted">{blocked ?? (busy ? "Another post is still generating; this one will wait in line." : `${left} names left for this style · press G`)}</span>
        </div>
      </div>
    </Panel>
  );
}
