"use client";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { ReelVoiceRow } from "@/lib/db/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/shadcn/select";
import { callAction } from "@/lib/actions/call";
import { setReelVoiceAction } from "@/lib/actions/voices";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import { BUILTIN, houseVoices, isHouseVoice, isSetUp } from "@/lib/reels/voices";
import { PlaySampleButton, useSamplePlayer } from "./voice-sample";

const toneOf = (v: ReelVoiceRow) => (v.id === BUILTIN ? "Chatterbox" : v.tone);

/**
 * The review page's narrator: a Select of the house voices with a ready sample (plus the current one and the
 * default) and ▶ to hear it. `value` null = the Settings default. Saved right away (only while in script).
 * An older reel's own voice outside the house list stays listed (last) so the Select is never blank.
 */
export function VoicePicker({ reelId, value, defaultId, voices, disabled }: {
  reelId: string; value: string | null; defaultId: string; voices: ReelVoiceRow[]; disabled?: boolean;
}) {
  const [chosen, setChosen] = useState<string | null>(value);
  const [saving, setSaving] = useState(false);
  const current = chosen ?? defaultId;
  // Ready house voices, plus the current one and the default whatever their state, so the Select is never blank.
  const house = houseVoices(voices);
  const list = [
    ...house.filter((v) => (isSetUp(v) && v.sample_status === "ready") || v.id === current || v.id === defaultId),
    ...voices.filter((v) => v.id === current && !isHouseVoice(v.id)),
  ];
  const currentRow = voices.find((v) => v.id === current);
  const signed = useSignedUrls([currentRow?.sample_status === "ready" ? currentRow.sample_path : null], "reels");
  const { playing, toggle } = useSamplePlayer();
  const url = currentRow?.sample_status === "ready" ? signed(currentRow.sample_path) : undefined;

  const pick = async (id: string) => {
    const next = id === defaultId ? null : id;
    if (next === chosen) return;
    const before = chosen;
    setChosen(next);
    setSaving(true);
    const r = await callAction(() => setReelVoiceAction(reelId, next));
    setSaving(false);
    if (!r.ok) { setChosen(before); toast.error(r.error); return; }
    toast.success(`Narrator: ${voices.find((v) => v.id === id)?.label ?? id}`);
  };

  // No house samples yet (voices not set up, or the PC hasn't made them): nothing to choose by ear.
  if (!house.some((v) => v.sample_status === "ready")) {
    return (
      <p className="text-xs text-muted">
        <span className="font-semibold text-ink">Narrator:</span> {currentRow?.label ?? current} (default).{" "}
        <Link href="/settings" className="font-semibold text-accent underline-offset-2 hover:underline">Set up voices in Settings</Link> to pick another one.
      </p>
    );
  }

  return (
    <div>
      <span id="narrator-label" className="mb-1 block text-xs font-semibold text-muted">Narrator</span>
      <div className="flex items-center gap-2">
        <Select value={current} onValueChange={(id) => void pick(id)} disabled={disabled || saving}>
          <SelectTrigger aria-labelledby="narrator-label" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" collisionPadding={{ top: 8, bottom: 80 }} className="max-h-[min(22rem,var(--radix-select-content-available-height))]">
            {list.map((v) => (
              <SelectItem key={v.id} value={v.id} disabled={!isSetUp(v)} className="min-h-11">
                <span className="font-semibold">{v.label}</span>
                <span className="text-muted">· {toneOf(v)}{v.id === defaultId ? " · default" : ""}{isSetUp(v) ? "" : " (not set up)"}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <PlaySampleButton label={currentRow?.label ?? current} playing={playing === current} disabled={!url} onClick={() => toggle(current, url)} />
      </div>
    </div>
  );
}
