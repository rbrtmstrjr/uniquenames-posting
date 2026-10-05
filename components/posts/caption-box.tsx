"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { rewriteCaptionAction, updateCaptionAction } from "@/lib/actions/posts";
import { callAction, optimistic } from "@/lib/actions/call";

export function CaptionBox({ postId, initial }: { postId: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  // The last save in flight, so Rewrite never races an edit's save (whichever lands last wins).
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve());
  // The box's latest text for the toast's Undo (its closure would only see the old render).
  const textRef = useRef(text);
  useEffect(() => { textRef.current = text; }, [text]);

  // Optimistic: treat the text as saved straight away (the Copy button and status line use it);
  // a failed save marks it unsaved again so the next blur retries, and says why.
  const persist = (value: string, previous: string, quiet = false) => {
    const run = (async () => {
      setSaving(true);
      const r = await optimistic(() => setSaved(value), () => setSaved(previous), () => updateCaptionAction(postId, value));
      setSaving(false);
      if (!r.ok) toast.error(r.error); else if (!quiet) toast.success("Caption saved");
    })();
    pendingSave.current = run;
    return run;
  };
  const save = () => { if (text !== saved) void persist(text, saved); };

  // Rewrite replaces the whole caption. It does not silently clobber the owner's words: an edit
  // still being saved (the box blurs as the button is tapped) finishes first, the box is
  // read-only while Gemini writes, and the success toast has Undo that puts the old text back.
  const rewrite = async () => {
    if (rewriting) return;
    setRewriting(true);
    await pendingSave.current;
    const before = text;
    const r = await callAction(() => rewriteCaptionAction(postId));
    setRewriting(false);
    if (!r.ok) { toast.error(r.error); return; }
    setText(r.caption);
    setSaved(r.caption);
    textRef.current = r.caption;
    toast.success("New caption written", {
      action: { label: "Undo", onClick: () => {
        // Only undo onto the untouched rewrite: if the owner has edited since, Undo would throw that away.
        if (textRef.current !== r.caption) { toast.error("The caption was edited after the rewrite, so Undo was skipped."); return; }
        setText(before); void persist(before, r.caption, true);
      } },
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error("Could not copy. Press and hold the caption to copy it.");
      return;
    }
    setCopied(true);
    toast.success("Caption copied");
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="caption" className="text-xs font-bold uppercase tracking-[.08em] text-muted">Caption</label>
        <span className="inline-flex items-center gap-1 text-xs text-muted" role="status" aria-live="polite">
          {rewriting ? <><Loader2 className="size-3 animate-spin" aria-hidden /> Writing…</>
            : saving ? <><Loader2 className="size-3 animate-spin" aria-hidden /> Saving…</> : text !== saved ? "Unsaved" : null}
        </span>
      </div>
      <Textarea id="caption" value={text} onChange={(e) => setText(e.target.value)} onBlur={save} rows={4} readOnly={rewriting} aria-busy={rewriting || undefined}
        className="min-h-28 resize-y leading-relaxed read-only:opacity-70" />
      <div className="flex flex-wrap gap-2">
        <Button variant="subtle" size="sm" onClick={copy} disabled={rewriting}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy caption</Button>
        <Button variant="subtle" size="sm" onClick={rewrite} loading={rewriting}>{!rewriting && <Sparkles className="size-4" aria-hidden />} Rewrite caption</Button>
      </div>
    </div>
  );
}
