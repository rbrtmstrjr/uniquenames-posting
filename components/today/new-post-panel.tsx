"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, Sparkles, Palette, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Panel } from "@/components/ui/panel";
import { DatePicker, formatDay } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/shadcn/select";
import { useHotkey } from "@/lib/realtime/hotkey";
import { createPostAction } from "@/lib/actions/posts";
import { callAction } from "@/lib/actions/call";
import type { Gender, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { useWorkerContext } from "@/components/shell/app-shell";
import { GenerateLockNote } from "@/components/shell/generate-lock-note";
import { canGenerate } from "@/lib/status/worker-health";
import { fontsOf, type PostFonts } from "@/lib/fonts/post-fonts";
import { titleText } from "@/lib/text/layout";
import { CatalogFontsLink, FontFields, FontSummary, fontStyle } from "@/components/fonts/font-select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/shadcn/collapsible";

const SAMPLE = { name: "Arlo Zenith", meaning: "peak strength with calm" };

/**
 * The post's fonts: one compact row ("Fonts  Quicksand · Comfortaa · Poppins", each in its own
 * face) that opens the three Selects and a small sample. Closed by default, so the panel stays
 * short on a phone; sizes and position stay in Settings.
 */
function PostFontsPicker({ value, onChange, handle }: { value: PostFonts; onChange: (v: PostFonts) => void; handle: string }) {
  return (
    <Collapsible className="rounded-xl border border-line">
      <CatalogFontsLink />
      <CollapsibleTrigger className="group flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left">
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-muted"><Type className="size-3.5" aria-hidden /> Fonts</span>
        <FontSummary value={value} className="flex-1 text-sm text-ink" />
        <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 pb-3">
        <FontFields idPrefix="post-font" value={value} onChange={onChange} />
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-center text-ink" role="group" aria-label="Font sample">
          {/* Capitals like the card (script fonts keep Title Case, as the PC stamps them). */}
          <div className="truncate text-xl leading-tight" style={fontStyle(value.title_font, "title_font")}>{titleText(SAMPLE.name, value.title_font)}</div>
          <div className="truncate text-sm" style={fontStyle(value.meaning_font, "meaning_font")}>{SAMPLE.meaning}</div>
          <div className="mt-0.5 truncate text-right text-xs text-muted" style={fontStyle(value.mark_font, "mark_font")}>{handle}</div>
        </div>
        <p className="text-xs text-muted">Used for this post; next time these are the defaults. Sizes and position are in Settings.</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

export function NewPostPanel({ settings, themes, stock, busy }: {
  settings: SettingsRow; themes: ThemeRow[]; stock: { gender: Gender; style: NameStyle; count: number }[]; busy: boolean;
}) {
  const { health } = useWorkerContext();
  const [gender, setGender] = useState<Gender>("boy");
  const [style, setStyle] = useState<NameStyle>("two-word");
  const [count, setCount] = useState<string>("auto");
  const [date, setDate] = useState(manilaToday);
  const [themeId, setThemeId] = useState<string>("");
  // Defaults to the fonts of the last post (saved in settings when a post is made).
  const [fonts, setFonts] = useState<PostFonts>(() => fontsOf(settings));
  const [pending, start] = useTransition();

  const genderThemes = useMemo(() => themes.filter((t) => t.gender === gender), [themes, gender]);
  const theme = genderThemes.find((t) => t.id === themeId) ?? genderThemes[0];
  const left = stock.find((s) => s.gender === gender && s.style === style)?.count ?? 0;
  const counts = Array.from({ length: settings.max_images - settings.min_images + 1 }, (_, i) => String(settings.min_images + i));
  const wanted = count === "auto" ? settings.min_images : Number(count);
  const gen = canGenerate(health);
  // The PC lock comes first: it is the one the owner fixes at the PC, not on this form.
  const blocked = !gen.ok ? gen.reason : left < wanted ? `Only ${left} ${gender} ${style} names left${count === "auto" ? "" : `, but you chose ${count} cards`}. Add names or pick fewer cards.` : !theme ? `No ${gender} theme left. Add a theme first.` : null;

  const generate = () => {
    if (blocked || pending) return;
    start(async () => {
      const r = await callAction(() => createPostAction({ gender, style, count: count === "auto" ? null : Number(count), postDate: date || manilaToday(), themeId: theme?.id, requestId: crypto.randomUUID(), fonts }));
      if (!r.ok) { toast.error(r.error); return; }
      // The action's revalidatePath re-renders Today with the new post in the same response.
      toast.success("Post queued. Cards will appear as they are made.");
    });
  };
  useHotkey("g", generate);

  return (
    <Panel title={`New post · ${formatDay(date || manilaToday())}`}>
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
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-1.5 text-xs font-semibold text-muted">
              <span id="theme-label" className="flex items-center gap-1.5"><Palette className="size-3.5" aria-hidden /> Theme</span>
              <Link href="/themes" className="text-accent hover:underline">Preview / change order</Link>
            </div>
            <Select value={theme?.id ?? ""} onValueChange={setThemeId} disabled={!genderThemes.length}>
              <SelectTrigger aria-labelledby="theme-label" className="w-full font-semibold">
                <SelectValue placeholder={`No ${gender} theme left`} />
              </SelectTrigger>
              {/* Bottom padding keeps the list clear of the phone tab bar. */}
              <SelectContent position="popper" collisionPadding={{ top: 8, bottom: 80 }} className="max-h-[min(20rem,var(--radix-select-content-available-height))]">
                {genderThemes.map((t, i) => <SelectItem key={t.id} value={t.id}>{i === 0 ? `${t.title} (next)` : t.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted">Post date</div>
            <DatePicker label="Post date" value={date} onChange={setDate} today={manilaToday()} />
          </div>
        </div>
        {theme && <p className="text-xs text-muted">{theme.backdrop} · {theme.outfit} · {theme.props}</p>}
        <PostFontsPicker value={fonts} onChange={setFonts} handle={settings.handle} />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={generate} loading={pending} disabled={!!blocked} className="w-full sm:w-auto">
            <Sparkles className="size-4" /> Generate post
          </Button>
          {!gen.ok
            ? <GenerateLockNote reason={gen.reason} className="w-full sm:w-auto" />
            : <span className="text-xs text-muted">{blocked ?? (busy ? "If a post is still being made, the new cards wait in line." : `${left} names left for this style · press G`)}</span>}
        </div>
      </div>
    </Panel>
  );
}
