"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Circle, Copy, Download, Film, Loader2, RefreshCw, SkipForward, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { ReelRow, ReelSceneRow, ReelSceneStatus } from "@/lib/db/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FadeImage } from "@/components/ui/fade-image";
import { Panel } from "@/components/ui/panel";
import { GenerateLockNote } from "@/components/shell/generate-lock-note";
import { useWorkerContext } from "@/components/shell/app-shell";
import { canGenerate } from "@/lib/status/worker-health";
import { useSignedUrls, signedDownloadUrl } from "@/lib/realtime/signed-urls";
import { deleteReelAction, redoReelSceneAction, rerenderReelAction, retryReelAction, skipReelSceneAction } from "@/lib/actions/reels";
import { callAction } from "@/lib/actions/call";
import type { ActionResult } from "@/lib/actions/result";
import { IMAGE_TRIES, SCENE_LABEL, canRedoScene, canRerender, canSkipScene, clock, imageCounts, isWorking, reelProgress, reelSteps, type StepState } from "@/lib/reels/status";
import { cn } from "@/lib/utils/cn";

const STEP_ICON: Record<StepState, React.ReactNode> = {
  done: <Check className="size-4" aria-hidden />,
  active: <Loader2 className="size-4 animate-spin" aria-hidden />,
  waiting: <Circle className="size-3" aria-hidden />,
  failed: <X className="size-4" aria-hidden />,
  attention: <AlertTriangle className="size-4" aria-hidden />,
};
const STEP_TONE: Record<StepState, string> = {
  done: "bg-ok/15 text-ok", active: "bg-accent-soft text-accent", waiting: "bg-surface-2 text-muted",
  failed: "bg-bad/12 text-bad", attention: "bg-warn/15 text-warn-text",
};
const STEP_WORD: Record<StepState, string> = { done: "done", active: "working", waiting: "waiting", failed: "failed", attention: "needs attention" };

const TILE_CHIP: Record<ReelSceneStatus, string> = {
  pending: "bg-black/45 text-white", queued: "bg-black/45 text-white", generating: "bg-accent text-accent-ink",
  done: "", failed: "bg-bad text-white", skipped: "bg-black/60 text-white",
};

/** A file name Windows and phones accept: "<title>.mp4". */
/** Reel statuses where images are still being made: a redo only requeues the image. */
const MAKING: ReelRow["status"][] = ["queued", "voicing", "imaging"];

const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim() || "reel"}.mp4`;

/**
 * A reel after approval: status + step strip + overall bar, banners (needs attention / stopped),
 * the 9:16 preview player when ready, and the grid of images (tap one → New picture / Skip).
 */
export function ReelProgress({ reel, scenes, onPatchScene, onPatchReel, music = false }: {
  reel: ReelRow; scenes: ReelSceneRow[]; music?: boolean;
  onPatchScene?: (id: string, patch: Partial<ReelSceneRow>) => void; onPatchReel?: (patch: Partial<ReelRow>) => void;
}) {
  const router = useRouter();
  const { health } = useWorkerContext();
  const gen = canGenerate(health);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const urlFor = useSignedUrls([...scenes.map((s) => s.photo_path), reel.preview_path], "reels");

  const progress = reelProgress(reel, scenes, music);
  const steps = reelSteps(reel, scenes);
  const counts = imageCounts(scenes);
  const working = isWorking(reel.status);
  const stuck = scenes.filter((s) => canSkipScene(reel.status, s) || (reel.status === "needs_attention" && s.status === "failed"));
  const open = scenes.find((s) => s.id === openId) ?? null;
  const firstDone = scenes.find((s) => s.status === "done" && s.photo_path);
  // The first signed URL stays on the <video> while the preview path is the same: a re-sign
  // (every ~50 min) must not restart playback. A new path (new render) gets a fresh URL and element.
  const signedPreview = urlFor(reel.preview_path);
  const [video, setVideo] = useState<{ path: string; url: string } | null>(null);
  if (reel.preview_path && signedPreview && video?.path !== reel.preview_path) setVideo({ path: reel.preview_path, url: signedPreview });
  const videoSrc = video && video.path === reel.preview_path ? video.url : signedPreview;

  const run = async (key: string, fn: () => Promise<ActionResult>, ok: string, after?: () => void) => {
    if (busy) return false;
    setBusy(key);
    const r = await callAction(fn);
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return false; }
    toast.success(ok);
    after?.();
    return true;
  };
  const redo = (s: ReelSceneRow) => run(`redo-${s.id}`, () => redoReelSceneAction(s.id), `Making image ${s.position} again…`,
    () => {
      onPatchScene?.(s.id, { status: "queued", error: null, attempts: 0 });
      // A reel that was ready / stopped goes back in line without its video (the server did the same).
      if (!MAKING.includes(reel.status)) onPatchReel?.({ status: "queued", preview_path: null });
    });
  const skip = (s: ReelSceneRow) => run(`skip-${s.id}`, () => skipReelSceneAction(s.id), `Image ${s.position} skipped`,
    () => onPatchScene?.(s.id, { status: "skipped", error: null }));
  const retry = () => run("retry", () => retryReelAction(reel.id), "Back in line for your PC", () => onPatchReel?.({ status: "queued", error: null }));
  const rerender = () => run("rerender", () => rerenderReelAction(reel.id), "Making the video again…", () => onPatchReel?.({ status: "queued", preview_path: null }));
  const download = async () => {
    if (!reel.preview_path) return;
    setBusy("download");
    const url = await signedDownloadUrl(reel.preview_path, fileName(reel.title), "reels").catch(() => null);
    setBusy(null);
    if (url) window.open(url, "_self"); else toast.error("Could not get the download link. Try again.");
  };
  const copyPath = async () => {
    try { await navigator.clipboard.writeText(reel.pc_path ?? ""); toast.success("PC path copied"); }
    catch { toast.error("Could not copy. Select the text instead."); }
  };

  const created = new Date(reel.created_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-ink sm:text-3xl">{reel.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {created} · {counts.total} images{reel.duration_s ? ` · ${clock(reel.duration_s)}` : ""}{reel.stage ? ` · ${reel.stage[0].toUpperCase()}${reel.stage.slice(1)}` : ""}
          </p>
        </div>
        <span data-testid="reel-status" aria-live="polite"><Badge tone={progress.tone} pulse={working && reel.status !== "queued"}>{progress.label}</Badge></span>
      </div>

      {reel.status === "failed" && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-semibold">The reel stopped.</div>
            <div className="mt-0.5 break-words text-bad/90">{reel.error ?? "Something went wrong on your PC."}</div>
            {!gen.ok && <div className="mt-1 font-semibold">{gen.reason}</div>}
          </div>
          <Button variant="danger" className="shrink-0" loading={busy === "retry"} disabled={!gen.ok || (!!busy && busy !== "retry")} onClick={() => void retry()}>
            <RefreshCw className="size-4" aria-hidden /> Try again
          </Button>
        </div>
      )}

      {stuck.length > 0 && (
        <div data-testid="attention-banner" className="space-y-2 rounded-2xl border border-warn/40 bg-warn/10 p-3 text-sm">
          <div className="flex items-start gap-2 font-semibold text-warn-text">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{stuck.length === 1 ? "1 image" : `${stuck.length} images`} failed {IMAGE_TRIES} times. Make it again, or skip it and the video uses the other pictures.</span>
          </div>
          {!gen.ok && <GenerateLockNote reason={gen.reason} extra="Skip still works." />}
          <ul className="space-y-2">
            {stuck.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface p-2">
                <div className="min-w-0 flex-1 basis-48">
                  <div className="font-semibold text-ink">Image {s.position}</div>
                  <div className="line-clamp-2 text-xs text-muted">{s.error ?? s.narration}</div>
                </div>
                <Button size="sm" variant="subtle" loading={busy === `redo-${s.id}`} disabled={!gen.ok || (!!busy && busy !== `redo-${s.id}`)} onClick={() => void redo(s)}>
                  <RefreshCw className="size-4" aria-hidden /> Retry image
                </Button>
                <Button size="sm" variant="ghost" loading={busy === `skip-${s.id}`} disabled={!!busy && busy !== `skip-${s.id}`} onClick={() => void skip(s)}>
                  <SkipForward className="size-4" aria-hidden /> Skip image
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <aside className="space-y-4 lg:sticky lg:top-20 lg:order-2">
          {reel.status === "ready" && reel.preview_path ? (
            <Panel title="Video">
              <div className="mx-auto aspect-[9/16] w-full max-w-[min(100%,340px)] overflow-hidden rounded-xl bg-black max-lg:max-h-[70dvh] max-lg:w-auto">
                <video key={reel.preview_path} src={videoSrc} poster={firstDone ? urlFor(firstDone.photo_path) : undefined}
                  controls playsInline preload="metadata" className="size-full object-contain" aria-label={`${reel.title} preview`} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button className="flex-1" loading={busy === "download"} onClick={() => void download()}>
                  {busy !== "download" && <Download className="size-4" aria-hidden />} Download preview
                </Button>
                <Button variant="subtle" className="flex-1" loading={busy === "rerender"}
                  disabled={!gen.ok || !canRerender(reel.status, scenes) || (!!busy && busy !== "rerender")} onClick={() => void rerender()}>
                  {busy !== "rerender" && <Film className="size-4" aria-hidden />} Make video again
                </Button>
              </div>
              {!gen.ok && <GenerateLockNote className="mt-2" reason={gen.reason} extra="Download still works." />}
              {reel.pc_path && (
                <div className="mt-3 rounded-xl bg-surface-2 p-3">
                  <div className="text-xs font-semibold text-muted">Full video on your PC</div>
                  <div className="mt-1 flex items-start gap-2">
                    <code className="min-w-0 flex-1 break-all font-mono text-xs text-ink">{reel.pc_path}</code>
                    <Button variant="ghost" size="icon" className="-my-2 -mr-2" aria-label="Copy PC path" onClick={() => void copyPath()}><Copy className="size-4" /></Button>
                  </div>
                </div>
              )}
              <p className="mt-2 text-xs text-muted">The preview is 720p and is removed after 14 days; the full 1080p video stays on your PC.</p>
            </Panel>
          ) : (
            <Panel title="Progress">
              <ol data-testid="step-strip" className="grid grid-cols-4 gap-1.5">
                {steps.map((s) => (
                  <li key={s.key} className="flex flex-col items-center gap-1.5 text-center" aria-label={`${s.label}: ${STEP_WORD[s.state]}`}>
                    <span className={cn("grid size-8 place-items-center rounded-full", STEP_TONE[s.state])}>{STEP_ICON[s.state]}</span>
                    <span className={cn("text-[11px] font-semibold leading-tight", s.state === "waiting" ? "text-muted" : "text-ink")}>{s.label}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex items-center gap-3">
                <div role="progressbar" aria-label="Reel progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.pct}
                  className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className={cn("h-full rounded-full transition-[width] duration-700", reel.status === "failed" ? "bg-bad" : reel.status === "needs_attention" ? "bg-warn" : "bg-accent")}
                    style={{ width: `${progress.pct}%` }} />
                </div>
                <span className="w-10 text-right text-sm font-bold tabular-nums text-ink">{progress.pct}%</span>
              </div>
              {working && !gen.ok && <GenerateLockNote className="mt-3" reason={gen.reason} extra="The reel carries on when it's back." />}
              {working && gen.ok && (
                <p className="mt-3 text-xs text-muted">
                  {reel.status === "queued" ? "In line. Cards being made go first, then your PC starts this reel." : "You can close this page — your PC keeps going."}
                </p>
              )}
              {reel.status === "ready" && !reel.preview_path && <p className="mt-3 text-xs text-muted">The preview has expired (kept 14 days). The full video is on your PC{reel.pc_path ? `: ${reel.pc_path}` : "."}</p>}
            </Panel>
          )}
        </aside>

        <Panel title="Images" className="min-w-0 lg:order-1" action={<span className="text-xs font-semibold tabular-nums text-muted">{counts.finished}/{counts.total}{counts.skipped ? ` · ${counts.skipped} skipped` : ""}</span>}>
          <p className="mb-3 text-xs text-muted">Tap a picture to see its line, make it again, or skip it.</p>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
            {scenes.map((s) => (
              <li key={s.id} data-testid="scene-tile">
                <button type="button" onClick={() => setOpenId(s.id)} aria-label={`Open image ${s.position}: ${SCENE_LABEL[s.status]}`}
                  className={cn("group relative block aspect-[9/16] w-full overflow-hidden rounded-xl bg-surface-2 text-left transition active:scale-[.98] focus-visible:outline-2 focus-visible:outline-accent",
                    s.status === "failed" && "ring-2 ring-bad/60")}>
                  {s.photo_path && s.status !== "generating" && s.status !== "queued"
                    ? <FadeImage key={s.photo_path} src={urlFor(s.photo_path)} alt={`Image ${s.position}: ${s.narration}`} className={s.status === "skipped" ? "opacity-40 grayscale" : undefined} />
                    : <div className={cn("absolute inset-0", s.status === "generating" && "shimmer animate-shimmer")} />}
                  <span className="absolute left-1.5 top-1.5 grid min-w-6 place-items-center rounded-md bg-black/50 px-1 text-[11px] font-bold tabular-nums text-white">{s.position}</span>
                  {s.status !== "done" && (
                    <span className={cn("absolute inset-x-1.5 bottom-1.5 flex items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold", TILE_CHIP[s.status])}>
                      {s.status === "generating" && <Loader2 className="size-3 animate-spin" aria-hidden />}
                      {s.status === "failed" && s.attempts < IMAGE_TRIES ? `Try ${s.attempts}/${IMAGE_TRIES}` : SCENE_LABEL[s.status]}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="text-bad" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" aria-hidden /> Delete reel</Button>
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpenId(null)} title={open ? `Image ${open.position}` : "Image"} description={open?.narration}>
        {open && (
          <div className="space-y-3">
            <div className="relative mx-auto aspect-[9/16] max-h-[52dvh] overflow-hidden rounded-xl bg-surface-2">
              {open.photo_path && open.status !== "queued" && open.status !== "generating"
                ? <FadeImage key={open.photo_path} src={urlFor(open.photo_path)} loading="eager" />
                : <div className="grid size-full place-items-center px-4 text-center text-sm text-muted">{SCENE_LABEL[open.status]}</div>}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Badge tone={open.status === "done" ? "ok" : open.status === "failed" ? "bad" : open.status === "generating" ? "accent" : "muted"}>{SCENE_LABEL[open.status]}</Badge>
              {open.error && <span className="min-w-0 truncate text-xs text-bad">{open.error}</span>}
            </div>
            {canRedoScene(reel.status, open) && !gen.ok && <GenerateLockNote reason={gen.reason} />}
            {canRedoScene(reel.status, open) && (reel.status === "ready" || reel.status === "failed") && (
              <p className="text-xs text-muted">A new picture means the video is made again afterwards.</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {canSkipScene(reel.status, open) && (
                <Button variant="ghost" loading={busy === `skip-${open.id}`} disabled={!!busy && busy !== `skip-${open.id}`} onClick={async () => { if (await skip(open)) setOpenId(null); }}>
                  <SkipForward className="size-4" aria-hidden /> Skip image
                </Button>
              )}
              {canRedoScene(reel.status, open) ? (
                <Button loading={busy === `redo-${open.id}`} disabled={!gen.ok || (!!busy && busy !== `redo-${open.id}`)} onClick={async () => { if (await redo(open)) setOpenId(null); }}>
                  <RefreshCw className="size-4" aria-hidden /> New picture
                </Button>
              ) : (
                <p className="text-xs text-muted">{open.status === "generating" ? "Your PC is making this picture now." : "This picture is waiting its turn."}</p>
              )}
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this reel?"
        description={working ? "Your PC stops working on it. The preview and pictures are deleted from the website." : "The preview and pictures are deleted from the website. The full video on your PC stays."}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
          <Button variant="danger" loading={busy === "delete"}
            onClick={async () => { if (await run("delete", () => deleteReelAction(reel.id), "Reel deleted")) { setConfirmDelete(false); router.push("/reels"); } }}>
            <Trash2 className="size-4" aria-hidden /> Delete reel
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
