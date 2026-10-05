"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Panel } from "@/components/ui/panel";
import { DatePicker } from "@/components/ui/date-picker";
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
import { AGE_CHOICES, AGE_LABELS, type AgeChoice } from "@/lib/planner/age";
import { postSummary } from "@/lib/today/summary";
import { useTodaySelection } from "@/components/today/selection";
import { cn } from "@/lib/utils/cn";

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
      <CollapsibleTrigger className="group flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3.5 text-left">
        <span className="shrink-0 text-sm font-semibold text-ink">Fonts</span>
        <FontSummary value={value} className="flex-1 text-sm text-ink" />
        <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3.5 pb-3.5">
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

/** A titled group of fields ("WHO", "LOOK", "CARDS"), labelled like the other small section titles. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const id = `np-${label.toLowerCase()}`;
  return (
    <div role="group" aria-labelledby={id}>
      <h3 id={id} className="mb-3 text-xs font-bold uppercase tracking-[.08em] text-muted">{label}</h3>
      {children}
    </div>
  );
}

/** One field: the same plain label above every control. */
function Field({ label, id, className, children }: { label: string; id?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0", className)}>
      <span id={id} className="mb-2 block text-sm font-semibold text-ink">{label}</span>
      {children}
    </div>
  );
}

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

export function NewPostPanel({ settings, themes, stock, busy }: {
  settings: SettingsRow; themes: ThemeRow[]; stock: { gender: Gender; style: NameStyle; count: number }[]; busy: boolean;
}) {
  const { health } = useWorkerContext();
  // Shared with the Stock card on Today (it highlights the matching count).
  const [{ gender, style }, setSel] = useTodaySelection();
  const [count, setCount] = useState<string>("auto");
  const [date, setDate] = useState(manilaToday);
  const [themeId, setThemeId] = useState<string>("");
  // Defaults to the fonts of the last post (saved in settings when a post is made).
  const [fonts, setFonts] = useState<PostFonts>(() => fontsOf(settings));
  // Always starts on Random (a different child and age per card); the owner picks a fixed age per post.
  const [age, setAge] = useState<AgeChoice>("random");
  const [pending, start] = useTransition();

  const genderThemes = useMemo(() => themes.filter((t) => t.gender === gender), [themes, gender]);
  const theme = genderThemes.find((t) => t.id === themeId) ?? genderThemes[0];
  const left = stock.find((s) => s.gender === gender && s.style === style)?.count ?? 0;
  const counts = Array.from({ length: settings.max_images - settings.min_images + 1 }, (_, i) => String(settings.min_images + i));
  const wanted = count === "auto" ? settings.min_images : Number(count);
  const gen = canGenerate(health);
  const summary = postSummary({ count, min: settings.min_images, max: settings.max_images, gender, style, age, themeTitle: theme?.title });
  // The PC lock comes first: it is the one the owner fixes at the PC, not on this form.
  const blocked = !gen.ok ? gen.reason : left < wanted ? `Only ${left} ${gender} ${style} names left${count === "auto" ? "" : `, but you chose ${count} cards`}. Add names or pick fewer cards.` : !theme ? `No ${gender} theme left. Add a theme first.` : null;

  const generate = () => {
    if (blocked || pending) return;
    start(async () => {
      const r = await callAction(() => createPostAction({ gender, style, count: count === "auto" ? null : Number(count), postDate: date || manilaToday(), themeId: theme?.id, requestId: crypto.randomUUID(), fonts, subjectAge: age }));
      if (!r.ok) { toast.error(r.error); return; }
      // The action's revalidatePath re-renders Today with the new post in the same response.
      toast.success("Post queued. Cards will appear as they are made.");
    });
  };
  useHotkey("g", generate);

  return (
    <Panel>
      <div className="@container space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl text-ink sm:text-2xl">New post</h2>
          <DatePicker label="Post date" value={date} onChange={setDate} today={manilaToday()} className="w-auto" />
        </div>

        <Section label="Who">
          {/* Phone: gender + style side by side (style gets more room for "Two-word"), age below. Wider: one row. */}
          <div className="grid grid-cols-[2fr_3fr] gap-4 @2xl:grid-cols-3">
            <Field label="Gender">
              <Segmented fill label="Gender" value={gender} onChange={(v) => { setSel({ gender: v, style }); setThemeId(""); }}
                options={[{ value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }]} />
            </Field>
            <Field label="Name style">
              <Segmented fill label="Name style" value={style} onChange={(v) => setSel({ gender, style: v })}
                options={[{ value: "two-word", label: "Two-word" }, { value: "single", label: "Single" }]} />
            </Field>
            <Field label="Child age" id="age-label" className="col-span-2 @2xl:col-span-1">
              <Select value={age} onValueChange={(v) => setAge(v as AgeChoice)}>
                <SelectTrigger aria-labelledby="age-label" className="w-full font-semibold">
                  {/* Short in the trigger; the list spells it out. */}
                  <SelectValue>{age === "random" ? "Random · 0–7" : AGE_LABELS[age]}</SelectValue>
                </SelectTrigger>
                <SelectContent position="popper" collisionPadding={{ top: 8, bottom: 80 }} className="max-h-[min(20rem,var(--radix-select-content-available-height))]">
                  {AGE_CHOICES.map((a) => <SelectItem key={a} value={a}>{AGE_LABELS[a]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </Section>

        <Section label="Look">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span id="theme-label" className="text-sm font-semibold text-ink">Theme</span>
                <Link href="/themes" className="-my-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">Preview / change order</Link>
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
              {theme && (
                <dl aria-label="Theme details" className="grid grid-cols-[4.75rem_1fr] gap-x-3 gap-y-1.5 rounded-xl bg-surface-2 px-3.5 py-3 text-sm">
                  {([["Backdrop", theme.backdrop], ["Outfit", theme.outfit], ["Props", theme.props]] as const).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted">{k}</dt>
                      <dd className="min-w-0 text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <PostFontsPicker value={fonts} onChange={setFonts} handle={settings.handle} />
          </div>
        </Section>

        <Section label="Cards">
          {/* Phone: an even 6-column grid (Auto takes two). Wider: one full-width track. */}
          <Segmented fill label="Number of cards" value={count} onChange={setCount} className="grid h-auto grid-cols-6 @2xl:flex @2xl:h-11"
            options={[
              { value: "auto", label: `Auto ${settings.min_images}–${settings.max_images}`, className: "col-span-2 h-11 @2xl:h-9 @2xl:flex-[1.8]" },
              ...counts.map((c) => ({ value: c, label: c, className: "h-11 @2xl:h-9" })),
            ]} />
        </Section>

        <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p data-testid="post-summary" className="text-sm font-semibold text-ink">{summary}</p>
            {!gen.ok
              ? <GenerateLockNote reason={gen.reason} className="w-fit" />
              : blocked
                ? <span className="block text-xs font-semibold text-warn-text">{blocked}</span>
                : busy
                  ? <span className="block text-xs text-muted">If a post is still being made, the new cards wait in line.</span>
                  : <span className="block text-xs text-muted">{left} names left<span className="hidden sm:inline"> · press G</span></span>}
          </div>
          <Button size="lg" onClick={generate} loading={pending} disabled={!!blocked} className="w-full shrink-0 sm:w-auto">
            <Sparkles className="size-4" /> Generate post
          </Button>
        </div>
      </div>
    </Panel>
  );
}
