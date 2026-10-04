import { cn } from "@/lib/utils/cn";

export function Panel({ title, action, className, children }: { title?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface p-4 shadow-soft sm:p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-xs font-bold uppercase tracking-[.08em] text-muted">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
