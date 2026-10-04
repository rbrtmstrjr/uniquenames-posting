"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateCaptionAction } from "@/lib/actions/posts";

export function CaptionBox({ postId, initial }: { postId: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [copied, setCopied] = useState(false);
  const save = async () => {
    if (text === saved) return;
    const r = await updateCaptionAction(postId, text);
    if (r.ok) { setSaved(text); toast.success("Caption saved"); } else toast.error(r.error);
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
      <label htmlFor="caption" className="text-xs font-bold uppercase tracking-[.08em] text-muted">Caption</label>
      <textarea id="caption" value={text} onChange={(e) => setText(e.target.value)} onBlur={save} rows={4}
        className="w-full resize-y rounded-xl border border-line bg-bg p-3 text-sm leading-relaxed text-ink outline-none focus:border-accent" />
      <Button variant="subtle" size="sm" onClick={copy}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy caption</Button>
    </div>
  );
}
