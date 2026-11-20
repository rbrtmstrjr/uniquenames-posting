"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, RotateCw, Square } from "lucide-react";
import type { AutopilotItemRow, AutopilotItemState, AutopilotRunRow } from "@/lib/db/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Panel } from "@/components/ui/panel";
import { callAction } from "@/lib/actions/call";
import { previewAutopilotAction, resumeAutopilotAction, startAutopilotAction, stopAutopilotAction, type RunPreview } from "@/lib/actions/autopilot";
import type { CardStats } from "@/lib/data/autopilot";
import { MAX_DAYS, dayLabel, labelText } from "@/lib/autopilot/plan";
import { summarize } from "@/lib/autopilot/summary";

const ACTIVE = new Set(["running", "waiting", "paused"]);
const STATE_TEXT: Record<AutopilotItemState, string> = { planned: "Waiting", naming: "Picking names", making: "Making cards", checking: "Checking", scheduled: "Scheduled", held: "Held" };
const STATE_TONE: Record<AutopilotItemState, "ok" | "warn" | "muted" | "accent"> = { planned: "muted", naming: "accent", making: "accent", checking: "accent", scheduled: "ok", held: "warn" };
/** " done/total" while cards are being made or checked; nothing when there are no cards yet. */
function progress(state: AutopilotItemState, st: CardStats | undefined): string {
  if (!st || st.total === 0) return "";
  if (state === "making") return ` ${st.done}/${st.total}`;
  if (state === "checking") return ` ${st.passed}/${st.total}`;
  return "";
}
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });

export function AutopilotPanel({ run, items, stats }: { run: AutopilotRunRow | null; items: AutopilotItemRow[]; stats: Record<string, CardStats> }) {
  const router = useRouter();
  const active = !!run && ACTIVE.has(run.status);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [active, router]);
  return active ? <RunView run={run!} items={items} stats={stats} /> : <StartView last={run} items={items} />;
}

function StartView({ last, items }: { last: AutopilotRunRow | null; items: AutopilotItemRow[] }) {
  const router = useRouter();
  const [days, setDays] = useState(MAX_DAYS);
  // The answer is stored with the day count it was made for, so a stale one is never shown for another count.
  const [result, setResult] = useState<{ days: number; preview: RunPreview | null; error: string | null } | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    let live = true;
    void callAction(() => previewAutopilotAction(days)).then((r) => {
      if (!live) return;
      setResult(r.ok ? { days, preview: r.preview, error: null } : { days, preview: null, error: r.error });
    });
    return () => { live = false; };
  }, [days]);
  const current = result?.days === days ? result : null;
  const preview = current?.preview ?? null;
  const error = current?.error ?? null;
  const start = async () => {
    setStarting(true);
    const r = await callAction(() => startAutopilotAction(days));
    setStarting(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("Autopilot started. Your PC picks it up within a minute.");
    router.refresh();
  };
  return (
    <div className="space-y-4">
      <Panel title="Make the next days">
        <div className="space-y-3">
          <label htmlFor="ap-days" className="block text-sm font-semibold text-ink">How many days</label>
          <select id="ap-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink">
            {Array.from({ length: MAX_DAYS }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n} day{n > 1 ? "s" : ""} ({n * 2} posts)</option>)}
          </select>
          {error ? <p className="text-sm text-bad" role="status">{error}</p> : !preview ? <p className="text-sm text-muted">Planning…</p> : (
            <div className="space-y-2 text-sm text-ink">
              <p><span className="font-semibold">{preview.range}</span> · {preview.posts} posts · one boy and one girl a day, between 8 and 10 AM and between 1 and 2 PM</p>
              <ul className="flex flex-wrap gap-1.5">{preview.days.map((d) => <li key={d.day}><Badge>{d.dayLabel}: {d.label}</Badge></li>)}</ul>
              {preview.problems.map((p) => <p key={p} className="text-xs text-warn-text">{p}</p>)}
            </div>
          )}
          <Button onClick={() => void start()} loading={starting} disabled={!preview}><Play className="size-4" /> Start</Button>
          <p className="text-xs text-muted">Keep your PC on with ComfyUI open until it finishes (about 10 minutes a post). Facebook posts them at their times, even with your PC off.</p>
        </div>
      </Panel>
      {last && <LastRun run={last} items={items} />}
    </div>
  );
}

function LastRun({ run, items }: { run: AutopilotRunRow; items: AutopilotItemRow[] }) {
  const s = summarize(run, items);
  return (
    <>
    <NeedsYou items={items.filter((i) => i.state === "held")} />
    <Panel title={run.status === "done" ? "Last run: finished" : "Last run: stopped"}>
      <p className="text-sm text-ink">{s.scheduled} scheduled · {s.held} held · {s.namesAdded} names added · {s.namesSkipped} names skipped · {s.remade} cards remade · {s.removed} removed · checks cost about ${s.costUsd.toFixed(2)}</p>
      <Activity run={run} />
    </Panel>
    </>
  );
}

function RunView({ run, items, stats }: { run: AutopilotRunRow; items: AutopilotItemRow[]; stats: Record<string, CardStats> }) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState<"stop" | "resume" | null>(null);
  const act = async (kind: "stop" | "resume") => {
    setBusy(kind);
    const r = await callAction(() => (kind === "stop" ? stopAutopilotAction(run.id) : resumeAutopilotAction(run.id)));
    setBusy(null);
    setAsk(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(kind === "stop" ? "Autopilot stopped." : "Autopilot carries on.");
    router.refresh();
  };
  const scheduled = items.filter((i) => i.state === "scheduled").length;
  const held = items.filter((i) => i.state === "held");
  const days = [...new Set(items.map((i) => i.day))];
  return (
    <div className="space-y-4">
      <Panel title="Autopilot" action={<Button variant="ghost" size="sm" onClick={() => setAsk(true)} disabled={busy !== null}><Square className="size-4" /> Stop</Button>}>
        {run.status === "paused" ? (
          <div className="mb-3 space-y-2 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad" role="alert">
            <p>{run.message || "Autopilot paused. Press Resume to carry on."}</p>
            <Button size="sm" onClick={() => void act("resume")} loading={busy === "resume"}><RotateCw className="size-4" /> Resume</Button>
          </div>
        ) : run.status === "waiting" ? (
          <p className="mb-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn-text" role="status">{run.message}</p>
        ) : (
          <p className="mb-3 text-sm text-ink" role="status">Working: {scheduled} of {items.length} posts scheduled.</p>
        )}
        <ol className="space-y-3">
          {days.map((day) => {
            const its = items.filter((i) => i.day === day).sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
            return (
              <li key={day} className="rounded-xl border border-line p-3">
                <div className="text-sm font-bold text-ink">{dayLabel(day)} · {labelText(its[0])}</div>
                <ul className="mt-2 space-y-1.5">
                  {its.map((i) => {
                    const st = i.post_id ? stats[i.post_id] : undefined;
                    return (
                      <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="w-20 shrink-0 tabular-nums text-muted">{TIME.format(new Date(i.scheduled_for))}</span>
                        <span className="font-semibold capitalize text-ink">{i.gender}</span>
                        <Badge tone={STATE_TONE[i.state]}>{STATE_TEXT[i.state]}{progress(i.state, st)}</Badge>
                        {st && st.remade > 0 && <span className="text-xs text-muted">{st.remade} remade</span>}
                        {i.post_id && <Link href={`/posts/${i.post_id}`} className="text-xs font-semibold text-accent underline-offset-2 hover:underline">Open post</Link>}
                        {i.note && i.state !== "scheduled" && i.state !== "held" && <p className="w-full text-xs text-muted">{i.note}</p>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      </Panel>
      <NeedsYou items={held} />
      <Panel title="Activity"><Activity run={run} /></Panel>
      <Dialog open={ask} onOpenChange={(o) => !o && setAsk(false)} title="Stop Autopilot?"
        description="Nothing new is made or scheduled. Posts already scheduled stay on Facebook (cancel one on its post page if you want). Posts being made stay on Posts, not scheduled.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAsk(false)}>Keep going</Button>
          <Button variant="danger" onClick={() => void act("stop")} loading={busy === "stop"}>Stop Autopilot</Button>
        </div>
      </Dialog>
    </div>
  );
}

function NeedsYou({ items }: { items: AutopilotItemRow[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Needs you">
      <Panel title="Needs you">
        <ul className="space-y-2 text-sm">
          {items.map((i) => (
            <li key={i.id}>
              <span className="font-semibold text-ink">{dayLabel(i.day)} · {labelText(i)} · <span className="capitalize">{i.gender}</span>:</span> <span className="text-muted">{i.note}</span>
              {i.post_id && <> <Link href={`/posts/${i.post_id}`} className="font-semibold text-accent hover:underline">Open post</Link></>}
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}

function Activity({ run }: { run: AutopilotRunRow }) {
  const events = [...(run.events ?? [])].reverse().slice(0, 40);
  if (!events.length) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto text-xs text-muted">
      {events.map((e, k) => <li key={`${e.at}-${k}`}>{e.text}</li>)}
    </ul>
  );
}
