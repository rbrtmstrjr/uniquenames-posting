import { cn } from "@/lib/utils/cn";
import { Badge as ShadcnBadge } from "@/components/ui/shadcn/badge";

// Our Badge API (tone + pulse) on the shadcn Badge; shadcn's variant is switched off so only
// our warm tone classes colour it.
const TONE = { ok: "bg-ok/12 text-ok", warn: "bg-warn/15 text-warn-text", bad: "bg-bad/12 text-bad", muted: "bg-surface-2 text-muted", accent: "bg-accent-soft text-accent" };

export function Badge({ tone = "muted", pulse, className, children }: { tone?: keyof typeof TONE; pulse?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <ShadcnBadge variant={null} className={cn("gap-1.5 px-2.5 py-1 text-xs font-semibold", TONE[tone], className)}>
      {pulse && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-current" /></span>}
      {children}
    </ShadcnBadge>
  );
}
