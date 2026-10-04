export function etaSeconds(remaining: number, recentDurationsSec: number[]): number {
  if (remaining <= 0) return 0;
  const recent = recentDurationsSec.filter((d) => d > 0).slice(-10);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 33;
  return Math.round(remaining * avg);
}

export function formatEta(sec: number): string {
  if (sec <= 0) return "finishing…";
  if (sec < 60) return "under a minute left";
  return `about ${Math.round(sec / 60)} min left`;
}

export function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
