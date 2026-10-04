import { cn } from "@/lib/utils/cn";

const TONE = { ok: "bg-ok/12 text-ok", warn: "bg-warn/15 text-warn", bad: "bg-bad/12 text-bad", muted: "bg-surface-2 text-muted", accent: "bg-accent-soft text-accent" };

export function Badge({ tone = "muted", pulse, className, children }: { tone?: keyof typeof TONE; pulse?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", TONE[tone], className)}>
      {pulse && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-current" /></span>}
      {children}
    </span>
  );
}
