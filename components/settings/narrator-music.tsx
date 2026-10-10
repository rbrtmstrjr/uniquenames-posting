"use client";
import { useCallback, useMemo, useState } from "react";
import { Check, Mic, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import type { ReelVoiceRow } from "@/lib/db/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/shadcn/slider";
import { Switch } from "@/components/ui/shadcn/switch";
import { PlaySampleButton, useSamplePlayer } from "@/components/reels/voice-sample";
import { callAction } from "@/lib/actions/call";
import { queueVoiceSamplesAction, setUpVoicesAction } from "@/lib/actions/voices";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeRows } from "@/lib/realtime/use-table";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import {
  byVoiceOrder, houseVoices, isStale, needsRef, needsSample, roundSpeed, SAMPLE_LABEL, sampleKey, speedLabel,
  SPEED_MAX, SPEED_MIN, SPEED_STEP, VOLUME_MAX, VOLUME_MIN,
} from "@/lib/reels/voices";
import { cn } from "@/lib/utils/cn";

export interface NarratorValue { reel_voice_id: string; reel_speed: number; reel_music: boolean; reel_music_volume: number }

/** Set up voices calls the action again while it keeps making clips (each call stops after ~270 s). */
const SETUP_MAX_CALLS = 12;

/**
 * Settings → Narrator & music. Before migration 006 (`voices` or `value` missing) it only explains
 * the database update. The voice rows stay live (realtime), so samples appear as the PC makes them.
 * Only the 4 house voices are shown (worker 2.6.0); the other rows stay in the database, hidden.
 */
export function NarratorMusic({ voices, value, savedSpeed, onChange }: {
  voices: ReelVoiceRow[] | null; value: NarratorValue | null; savedSpeed: number; onChange: (p: Partial<NarratorValue>) => void;
}) {
  if (!voices || !value) {
    return (
      <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">
        Narrator voices and background music need the database update first (run <span className="font-semibold text-ink [overflow-wrap:anywhere]">supabase/migrations/006_reel_voices.sql</span>).
        Until then reels use the built-in voice with no music.
      </p>
    );
  }
  return <NarratorMusicReady initial={voices} value={value} savedSpeed={savedSpeed} onChange={onChange} />;
}

function NarratorMusicReady({ initial, value, savedSpeed, onChange }: {
  initial: ReelVoiceRow[]; value: NarratorValue; savedSpeed: number; onChange: (p: Partial<NarratorValue>) => void;
}) {
  const refetch = useCallback(async () => {
    const { data, error } = await createClient().from("reel_voices").select("*");
    return error ? null : ((data ?? []) as ReelVoiceRow[]);
  }, []);
  const [rows] = useRealtimeRows<ReelVoiceRow>("reel_voices", initial, { key: "settings-voices", sort: byVoiceOrder, refetch });
  const voices = useMemo(() => houseVoices(rows), [rows]);
  const signed = useSignedUrls(voices.map((v) => (v.sample_status === "ready" ? v.sample_path : null)), "reels");
  const { playing, toggle } = useSamplePlayer();
  const [busy, setBusy] = useState<null | "setup" | "samples">(null);
  const [confirm, setConfirm] = useState(false);

  const key = sampleKey(savedSpeed);
  const missingRefs = voices.filter(needsRef).length;
  const toSample = voices.filter((v) => needsSample(v, key)).length;
  const stale = voices.filter((v) => isStale(v, key)).length;
  const ready = voices.filter((v) => v.sample_status === "ready").length;
  const making = voices.filter((v) => v.sample_status === "queued" || v.sample_status === "making").length;
  const speedDirty = roundSpeed(value.reel_speed) !== roundSpeed(savedSpeed);
  const current = useMemo(() => voices.find((v) => v.id === value.reel_voice_id), [voices, value.reel_voice_id]);

  const setUp = async () => {
    setConfirm(false);
    setBusy("setup");
    for (let i = 0; i < SETUP_MAX_CALLS; i++) {
      const r = await callAction(() => setUpVoicesAction());
      if (!r.ok) { toast.error(r.error); break; }
      if (r.remaining === 0) { toast.success("Voices are set up. Your PC makes the samples when it's free."); break; }
      if (r.made === 0) { toast.error(r.lastError ? `${r.remaining} voices could not be set up. ${r.lastError}` : `${r.remaining} voices could not be set up. Try again.`); break; }
    }
    setBusy(null);
  };
  const makeSamples = async () => {
    setBusy("samples");
    const r = await callAction(() => queueVoiceSamplesAction());
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.queued ? `${r.queued} sample${r.queued === 1 ? "" : "s"} in line. Your PC makes them when it's free.` : "Every sample is up to date.");
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span aria-hidden className="text-xs font-semibold text-muted">Narration speed</span>
            <span className="text-sm font-bold tabular-nums text-ink" data-testid="speed-value">{speedLabel(value.reel_speed)}</span>
          </div>
          <Slider aria-label="Narration speed" min={SPEED_MIN} max={SPEED_MAX} step={SPEED_STEP} value={[value.reel_speed]}
            onValueChange={([v]) => onChange({ reel_speed: roundSpeed(v) })} className="mt-1" />
          <p className="mt-1.5 text-xs text-muted">Faster keeps the pitch. Scripts get a few more words so a reel stays 1:00–1:30. 1.00× is the natural pace.</p>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="reel-music" className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
              <Switch id="reel-music" checked={value.reel_music} onCheckedChange={(v) => onChange({ reel_music: v })} /> Background music
            </label>
            <span className={cn("text-sm font-bold tabular-nums", value.reel_music ? "text-ink" : "text-muted")} data-testid="volume-value">{value.reel_music_volume} %</span>
          </div>
          <Slider aria-label="Music volume" min={VOLUME_MIN} max={VOLUME_MAX} step={1} value={[value.reel_music_volume]} disabled={!value.reel_music}
            onValueChange={([v]) => onChange({ reel_music_volume: v })} className={cn("mt-1", !value.reel_music && "opacity-50")} />
          <p className="mt-1.5 text-xs text-muted">{value.reel_music
            ? "A new calm piano piece for every reel, quieter while the voice speaks."
            : "Reels are made with the voice only."}</p>
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">Default narrator{current ? <span className="font-normal text-muted"> · {current.label}</span> : null}</h3>
            <p className="text-xs text-muted" data-testid="voice-summary">
              {ready} of {voices.length} samples ready{making ? ` · ${making} being made` : ""}{stale ? ` · ${stale} made with older settings` : ""}.
              {" "}Each reel can use another voice on its review page.
            </p>
          </div>
          {toSample > 0 && missingRefs < voices.length && (
            <Button variant="subtle" size="sm" loading={busy === "samples"} disabled={!!busy || speedDirty} onClick={() => void makeSamples()}>
              {busy !== "samples" && <Wand2 className="size-4" aria-hidden />} Make samples ({toSample})
            </Button>
          )}
        </div>
        {speedDirty && toSample + stale > 0 && <p className="mb-3 text-xs text-warn-text">Save settings first, so new samples use {speedLabel(value.reel_speed)}.</p>}

        {missingRefs > 0 && (
          <div className="mb-3 flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent-soft/50 p-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-sm text-ink">
              {busy === "setup"
                ? <span role="status">Making reference clips… <span className="font-semibold tabular-nums">{voices.length - missingRefs} of {voices.length}</span></span>
                : <>{missingRefs === voices.length ? "One-time setup:" : `${missingRefs} voices still need setup:`} Gemini records a short clip of each voice, then your PC copies it for reels.</>}
            </p>
            <Button size="sm" loading={busy === "setup"} disabled={!!busy} onClick={() => setConfirm(true)}>
              {busy !== "setup" && <Sparkles className="size-4" aria-hidden />} Set up voices
            </Button>
          </div>
        )}

        <div role="radiogroup" aria-label="Default narrator" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {voices.map((v) => {
            const selected = v.id === value.reel_voice_id;
            const off = needsRef(v);
            const s = isStale(v, key) ? { label: "Old sample", tone: "muted" as const } : SAMPLE_LABEL[v.sample_status];
            const url = v.sample_status === "ready" ? signed(v.sample_path) : undefined;
            return (
              <div key={v.id} data-testid={`voice-${v.id}`}
                className={cn("flex items-center gap-1 rounded-xl border p-1 pl-3 transition-colors",
                  selected ? "border-accent bg-accent-soft/60" : "border-line bg-surface", off && "opacity-60")}>
                <button type="button" role="radio" aria-checked={selected} disabled={off} onClick={() => onChange({ reel_voice_id: v.id })}
                  className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-lg py-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed">
                  <span className="flex w-full min-w-0 items-center gap-1.5">
                    {selected && <Check className="size-3.5 shrink-0 text-accent" aria-hidden />}
                    <span className="truncate text-sm font-semibold text-ink">{v.label}</span>
                  </span>
                  <span className="w-full truncate text-xs text-muted">{v.tone}</span>
                  {off ? <Badge className="mt-1 whitespace-nowrap px-1.5 py-0 text-[11px]">Not set up</Badge>
                    : v.sample_status !== "ready" || s.label === "Old sample"
                      ? <Badge tone={s.tone} pulse={v.sample_status === "making"} className="mt-1 whitespace-nowrap px-1.5 py-0 text-[11px]">{s.label}</Badge>
                      : null}
                  {v.sample_status === "failed" && v.error && <span className="sr-only">Sample failed: {v.error}</span>}
                </button>
                <PlaySampleButton label={v.label} playing={playing === v.id} disabled={!url} onClick={() => toggle(v.id, url)} />
              </div>
            );
          })}
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Mic className="size-3.5" aria-hidden /> Samples are made by your PC in the reel style (line by line, natural pauses), at the saved speed.</p>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm} title="Set up the voices?"
        description={`Gemini records a 10-second clip for each of the ${missingRefs} voices (about $0.01 each, one time). Your PC then makes a sample of each when it's free.`}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>Not now</Button>
          <Button onClick={() => void setUp()}><Sparkles className="size-4" aria-hidden /> Set up voices</Button>
        </div>
      </Dialog>
    </div>
  );
}
