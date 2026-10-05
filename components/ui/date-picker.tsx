"use client";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/shadcn/popover";
import { Calendar } from "@/components/ui/shadcn/calendar";
import { Button } from "@/components/ui/button";

// A date field on shadcn Popover + Calendar. The value stays a plain "YYYY-MM-DD" string (what
// the actions take); the button shows it as e.g. "Mon, Oct 5". Dates are built from their
// parts in local time, so no timezone shift can move the day.
export const toDate = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const formatDay = (ymd: string) => toDate(ymd).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function DatePicker({ value, onChange, today, label, className }: {
  value: string; onChange: (ymd: string) => void; today: string; label: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = toDate(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={`${label}: ${formatDay(value)}`}
        className={cn("inline-flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-bg px-3 text-sm font-semibold text-ink outline-none transition-[box-shadow] hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:w-auto", className)}>
        <CalendarDays className="size-4 text-muted" aria-hidden />
        <span className="whitespace-nowrap">{formatDay(value)}</span>
        {value === today && <span className="text-xs font-normal text-muted">today</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar mode="single" required selected={selected} defaultMonth={selected} today={toDate(today)}
          onSelect={(d: Date | undefined) => { if (d) { onChange(toYmd(d)); setOpen(false); } }} />
        <div className="border-t border-line p-2">
          <Button variant="ghost" size="sm" className="w-full text-accent" onClick={() => { onChange(today); setOpen(false); }}>Today</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
