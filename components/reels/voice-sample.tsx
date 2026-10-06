"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/** Load `url` into the shared player and start it (outside the hook: the element is the browser's, not React state). */
function start(a: HTMLAudioElement, url: string, onEnd: () => void): Promise<void> | undefined {
  a.pause();
  a.src = url;
  a.onended = onEnd;
  return a.play();
}

/** One sample plays at a time; tapping the playing one stops it. */
export function useSamplePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  const toggle = useCallback((id: string, url: string | undefined) => {
    const a = audio.current ?? (audio.current = new Audio());
    if (playing === id) { a.pause(); setPlaying(null); return; }
    if (!url) return;
    setPlaying(id);
    const p = start(a, url, () => setPlaying((cur) => (cur === id ? null : cur)));
    if (p && typeof p.catch === "function") p.catch(() => { setPlaying((cur) => (cur === id ? null : cur)); toast.error("Could not play the sample."); });
  }, [playing]);
  return { playing, toggle };
}

/** ▶ / ❚❚ for one voice's sample (disabled while there is no sample to play). */
export function PlaySampleButton({ label, playing, disabled, onClick, className }: {
  label: string; playing: boolean; disabled?: boolean; onClick: () => void; className?: string;
}) {
  return (
    <Button variant="subtle" size="icon" aria-label={playing ? `Stop ${label} sample` : `Play ${label} sample`} aria-pressed={playing}
      disabled={disabled} onClick={onClick} className={cn("shrink-0 rounded-full", playing && "bg-accent text-accent-ink hover:bg-accent", className)}>
      {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-px" aria-hidden />}
    </Button>
  );
}
