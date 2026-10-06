"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, RotateCcw, Shuffle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ReelRow, ReelSceneRow, ReelThemeId } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { Panel } from "@/components/ui/panel";
import { Input } from "@/components/ui/shadcn/input";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { GenerateLockNote } from "@/components/shell/generate-lock-note";
import { useWorkerContext } from "@/components/shell/app-shell";
import { canGenerate } from "@/lib/status/worker-health";
import { approveReelAction, deleteReelAction, rewriteReelScriptAction, saveReelScriptAction } from "@/lib/actions/reels";
import { callAction } from "@/lib/actions/call";
import { useNow } from "@/lib/realtime/hooks";
import { LINE_MAX_WORDS, TITLE_MAX, clock, estimateSeconds, wordCount, wordTarget } from "@/lib/reels/status";
import type { Narrator } from "@/lib/data/voices";
import type { ThemeChoice } from "@/lib/data/reel-themes";
import { lineMood } from "@/lib/reels/labels";
import { undoll } from "@/lib/reels/prompt";
import { isThemeId, THEME_LABEL } from "@/lib/reels/themes";
import { VoicePicker } from "./voice-picker";
import { ThemePicker } from "./theme-picker";
import { cn } from "@/lib/utils/cn";

type Text = { narration: string; idea: string };
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const same = (a: Text, b: Text) => oneLine(a.narration) === oneLine(b.narration) && oneLine(a.idea) === oneLine(b.idea);

/** m:ss since `since`, ticking on its own (so the long list doesn't re-render every second). */
function Elapsed({ since }: { since: number }) {
  const now = useNow(1000);
  return <span className="tabular-nums">{clock((now - since) / 1000)}</span>;
}

const NO_LINES = "This script has no lines. Tap New script.";

/** The first thing that would make Save fail, worded like the server ("Line N …"). */
function firstProblem(title: string, lines: (Text & { position: number })[]): string | null {
  if (!oneLine(title)) return "Give the reel a title.";
  if (oneLine(title).length > TITLE_MAX) return `Keep the title under ${TITLE_MAX} characters.`;
  if (!lines.length) return NO_LINES;
  for (const l of lines) {
    const at = `Line ${l.position}`;
    if (!oneLine(l.narration)) return `${at} has no words.`;
    if (wordCount(l.narration) > LINE_MAX_WORDS) return `${at} is longer than ${LINE_MAX_WORDS} words.`;
    if (!oneLine(l.idea)) return `${at} has no picture idea.`;
  }
  return null;
}

/**
 * The review page for a reel in `script`: numbered lines (narration in an auto-growing box with a
 * live word count, the picture idea in a disclosure), totals at the top, and one action bar —
 * sticky above the tab bar on phones, in the side panel on desktop.
 */
/** A line's feeling (chip) + framing and camera move (subtle text); read-only, set by the script engine. */
function LineMood({ scene }: { scene: ReelSceneRow }) {
  const m = lineMood(scene);
  if (!m) return null;
  const extra = [m.shot, m.motion].filter(Boolean).join(" · ");
  return (
    <div data-testid={`mood-${scene.position}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent">
        <span aria-hidden>{m.emoji}</span> {m.emotion}
      </span>
      {m.key && <span className="rounded-full bg-warn/15 px-2 py-0.5 font-semibold text-warn-text">Key moment</span>}
      {extra && <span className="min-w-0 text-muted">{extra}</span>}
    </div>
  );
}

export function ScriptReview({ reel, scenes, onApproved, narrator = null, themes = null }: {
  reel: ReelRow; scenes: ReelSceneRow[]; onApproved?: () => void; narrator?: Narrator | null; themes?: ThemeChoice | null;
}) {
  const router = useRouter();
  const { health } = useWorkerContext();
  const gen = canGenerate(health);
  const [edits, setEdits] = useState<Record<string, Text>>({});
  const [saved, setSaved] = useState<Record<string, Text>>({});
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "approve" | "rewrite" | "delete">(null);
  const [confirm, setConfirm] = useState<null | "rewrite" | "delete">(null);
  const [rewriteStart, setRewriteStart] = useState(0);

  const baseTitle = savedTitle ?? reel.title;
  const title = titleEdit ?? baseTitle;
  const lines = useMemo(() => scenes.map((s) => {
    const base = saved[s.id] ?? { narration: s.narration, idea: s.idea };
    const cur = edits[s.id] ?? base;
    return { ...s, base, narration: cur.narration, idea: cur.idea, dirty: !same(cur, base) };
  }), [scenes, edits, saved]);
  const dirtyLines = lines.filter((l) => l.dirty);
  const titleDirty = oneLine(title) !== oneLine(baseTitle);
  const dirty = titleDirty || dirtyLines.length > 0;
  const problem = firstProblem(title, lines);
  const totalWords = lines.reduce((n, l) => n + wordCount(l.narration), 0);
  // The script length the prompt aims for (90–120 s of speech at the narration speed).
  const speed = narrator?.speed ?? 1;
  const TARGET = wordTarget(speed);
  const secs = estimateSeconds(totalWords, speed);
  const lengthOk = totalWords >= TARGET.lo && totalWords <= TARGET.hi;

  const edit = (id: string, patch: Partial<Text>) => setEdits((prev) => {
    const l = lines.find((x) => x.id === id)!;
    return { ...prev, [id]: { narration: l.narration, idea: l.idea, ...patch } };
  });
  const discard = () => { setEdits({}); setTitleEdit(null); };

  const save = async (quiet = false): Promise<boolean> => {
    const payload = { title: oneLine(title), lines: dirtyLines.map((l) => ({ id: l.id, narration: oneLine(l.narration), idea: oneLine(l.idea) })) };
    const r = await callAction(() => saveReelScriptAction(reel.id, payload));
    if (!r.ok) { toast.error(r.error); return false; }
    const sent: Record<string, Text> = Object.fromEntries(payload.lines.map((l) => [l.id, { narration: l.narration, idea: l.idea }]));
    setSaved((prev) => ({ ...prev, ...sent }));
    setSavedTitle(payload.title);
    // Only drop edits that are exactly what was saved: anything typed while saving stays (and stays dirty).
    setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([id, e]) => !(sent[id] && same(e, sent[id])))));
    setTitleEdit((prev) => (prev !== null && oneLine(prev) === payload.title ? null : prev));
    if (!quiet) toast.success("Script saved");
    return true;
  };
  const onSave = async () => { setBusy("save"); await save(); setBusy(null); };

  const approve = async () => {
    setBusy("approve");
    if (dirty && !(await save(true))) { setBusy(null); return; }
    const r = await callAction(() => approveReelAction(reel.id));
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("Approved — your PC will make the reel");
    onApproved?.();
  };

  const rewrite = async () => {
    setConfirm(null); setBusy("rewrite"); setRewriteStart(Date.now());
    const r = await callAction(() => rewriteReelScriptAction(reel.id));
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    setEdits({}); setSaved({}); setTitleEdit(null); setSavedTitle(null);
    toast.success("New script written");
    router.refresh();
  };

  const remove = async () => {
    setBusy("delete");
    const r = await callAction(() => deleteReelAction(reel.id));
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    setConfirm(null);
    toast.success("Reel deleted");
    router.push("/reels");
  };

  const locked = busy === "rewrite" || busy === "approve" || busy === "delete";
  // The reel's look: the pinned theme (007), else the Settings default, else knitted (dolls).
  const [themeSaved, setThemeSaved] = useState<ReelThemeId | null>(null);
  const themeId: ReelThemeId = themeSaved ?? (isThemeId(reel.theme_id) ? reel.theme_id : themes?.defaultId ?? "knitted");
  const dolls = themeId === "knitted";
  const cast = dolls ? reel.doll_cast : { adult: undoll(reel.doll_cast.adult), child: undoll(reel.doll_cast.child) };

  return (
    <div className="pb-40 md:pb-28 lg:pb-0">
      <div className="mb-4 space-y-2">
        <label htmlFor="reel-title" className="sr-only">Reel title</label>
        <Input id="reel-title" value={title} maxLength={TITLE_MAX} disabled={locked} onChange={(e) => setTitleEdit(e.target.value)}
          className="h-auto min-h-12 border-transparent bg-transparent px-2 -mx-2 font-display text-2xl text-ink hover:border-line focus-visible:border-ring sm:text-3xl md:text-3xl" />
        <p className="text-sm text-muted">
          Check every line, then approve.{reel.stage ? ` · ${reel.stage[0].toUpperCase()}${reel.stage.slice(1)}` : ""}{reel.topic ? ` · Topic: ${reel.topic}` : ""}
        </p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:order-2">
          <Panel title="Script">
            <div data-testid="script-totals" className="grid grid-cols-3 gap-2 text-center">
              {[
                [String(lines.length), "lines"],
                [String(totalWords), "words"],
                [`≈ ${clock(secs)}`, "long"],
              ].map(([n, l]) => (
                <div key={l} className="rounded-xl bg-surface-2 px-2 py-2.5">
                  <div className={cn("text-lg font-bold tabular-nums leading-none", l !== "lines" && !lengthOk ? "text-warn-text" : "text-ink")}>{n}</div>
                  <div className="mt-1 text-xs text-muted">{l === "long" ? "long" : `${l}`}</div>
                </div>
              ))}
            </div>
            <p className={cn("mt-2 text-xs", lengthOk ? "text-muted" : "text-warn-text")}>
              {lengthOk ? `Good length (aim ${TARGET.lo}–${TARGET.hi} words).` : `Aim for ${TARGET.lo}–${TARGET.hi} words (about 1:30–2:00).`}
            </p>
            {themes && reel.theme_id !== undefined && (
              <div className="mt-3 border-t border-line pt-3" data-testid="theme">
                <ThemePicker reelId={reel.id} value={themeId} defaultId={themes.defaultId} themes={themes.themes} disabled={locked || busy === "save"}
                  onSaved={setThemeSaved} />
              </div>
            )}
            {narrator && (
              <div className="mt-3 border-t border-line pt-3" data-testid="narrator">
                <VoicePicker reelId={reel.id} value={reel.voice_id ?? null} defaultId={narrator.defaultId} voices={narrator.voices} disabled={locked} />
              </div>
            )}
            <div className="mt-3 hidden space-y-1 border-t border-line pt-3 text-xs text-muted lg:block">
              <div><span className="font-semibold text-ink">{dolls ? "Grown-up doll" : "Grown-up"}:</span> {cast.adult}</div>
              <div><span className="font-semibold text-ink">{dolls ? "Child doll" : "Child"}:</span> {cast.child}</div>
            </div>

            {/* Phones: fixed above the tab bar. Desktop: part of this panel. */}
            <div data-testid="review-actions"
              className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 space-y-2 border-t border-line bg-surface/95 px-4 py-3 shadow-soft backdrop-blur md:bottom-0 md:left-[232px] md:px-6 lg:static lg:mt-4 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
              {problem && <p role="status" className="rounded-xl bg-bad/10 px-3 py-2 text-xs font-semibold text-bad">{problem}</p>}
              {!problem && !gen.ok && <GenerateLockNote reason={gen.reason} extra="You can still edit and save." />}
              {!problem && gen.ok && dirty && <p className="text-xs text-muted lg:text-center">Unsaved changes — Approve saves them first.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button className="min-w-0 flex-1 lg:order-first lg:basis-full" size="md" loading={busy === "approve"}
                  disabled={!gen.ok || !!problem || (locked && busy !== "approve") || busy === "save"} onClick={() => void approve()}>
                  {busy !== "approve" && <Clapperboard className="size-4" aria-hidden />} Approve and make reel
                </Button>
                {dirty ? (
                  <>
                    <Button variant="subtle" loading={busy === "save"} disabled={!!problem || locked} onClick={() => void onSave()}>Save</Button>
                    <Button variant="ghost" size="icon" aria-label="Discard changes" disabled={locked || busy === "save"} onClick={discard}><RotateCcw className="size-4" /></Button>
                  </>
                ) : (
                  <Button variant="subtle" loading={busy === "rewrite"} disabled={locked && busy !== "rewrite"} onClick={() => setConfirm("rewrite")}>
                    {busy !== "rewrite" && <Shuffle className="size-4" aria-hidden />} New script
                  </Button>
                )}
                <Button variant="danger" size="icon" aria-label="Delete reel" disabled={locked} onClick={() => setConfirm("delete")}><Trash2 className="size-4" /></Button>
              </div>
            </div>
          </Panel>
        </aside>

        <section aria-label="Script lines" className="min-w-0 lg:order-1">
          {busy === "rewrite" && (
            <p role="status" className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-accent-soft px-3 py-2.5 text-sm font-semibold text-accent">
              <span>Gemini is writing a new script… usually 1–3 minutes.</span>
              <Elapsed since={rewriteStart} />
            </p>
          )}
          <ol className={cn("space-y-2.5", busy === "rewrite" && "pointer-events-none opacity-50")}>
            {lines.map((l) => {
              const words = wordCount(l.narration);
              const long = words > LINE_MAX_WORDS;
              return (
                <li key={l.id} className={cn("rounded-2xl border bg-surface p-3 shadow-soft transition-colors sm:p-4", l.dirty ? "border-accent/50" : "border-line")}>
                  <div className="flex items-start gap-3">
                    <span aria-hidden className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold tabular-nums text-muted">{l.position}</span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold uppercase tracking-[.06em] text-muted"><span className="sr-only">Line {l.position}</span><span aria-hidden>{l.beat}</span></span>
                        <span data-testid={`words-${l.position}`} className={cn("tabular-nums", long ? "font-bold text-bad" : "text-muted")}>
                          {words} words{long ? ` · max ${LINE_MAX_WORDS}` : ""}{l.dirty ? " · edited" : ""}
                        </span>
                      </div>
                      <Textarea aria-label={`Line ${l.position} narration`} value={l.narration} rows={1} disabled={locked}
                        aria-invalid={long || !oneLine(l.narration) || undefined}
                        onChange={(e) => edit(l.id, { narration: e.target.value })}
                        className="min-h-11 resize-none px-3 py-2 text-base leading-snug md:text-[15px]" />
                      <LineMood scene={l} />
                      <Disclosure triggerClassName="min-h-11 text-xs font-normal text-muted"
                        summary={<span className="flex min-w-0 gap-1.5"><span className="shrink-0 font-semibold text-ink">Picture idea</span><span className="line-clamp-1 break-all">{l.idea}</span></span>}>
                        <Textarea aria-label={`Line ${l.position} picture idea`} value={l.idea} disabled={locked}
                          onChange={(e) => edit(l.id, { idea: e.target.value })} className="mb-1 min-h-16 text-sm" />
                        <p className="text-xs text-muted">Changing the idea changes this line&apos;s picture. {dolls ? "The two dolls and the knitted style are added for you." : `The two characters and the ${THEME_LABEL[themeId].label} style are added for you.`}</p>
                      </Disclosure>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <Dialog open={confirm === "rewrite"} onOpenChange={(o) => !o && setConfirm(null)} title="Write a new script?"
        description="Gemini writes a new title and new lines for the same topic. This script is replaced.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>Keep this one</Button>
          <Button onClick={() => void rewrite()}><Shuffle className="size-4" aria-hidden /> New script</Button>
        </div>
      </Dialog>
      <Dialog open={confirm === "delete"} onOpenChange={(o) => !o && setConfirm(null)} title="Delete this reel?"
        description="The script is deleted. Nothing has been made on your PC yet.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>Keep it</Button>
          <Button variant="danger" loading={busy === "delete"} onClick={() => void remove()}><Trash2 className="size-4" aria-hidden /> Delete reel</Button>
        </div>
      </Dialog>
      {/* Approved: the page switches to progress by itself (realtime); this keeps the check visible meanwhile. */}
      <span className="sr-only" aria-live="polite">{busy === "approve" ? "Approving…" : ""}</span>
    </div>
  );
}
