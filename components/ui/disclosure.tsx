"use client";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/shadcn/collapsible";

// A show/hide section on the shadcn Collapsible (replaces <details>/<summary>): a full-width
// 44px trigger with a chevron that turns when open.
export function Disclosure({ summary, className, triggerClassName, children, defaultOpen }: {
  summary: React.ReactNode; className?: string; triggerClassName?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={className}>
      <CollapsibleTrigger className={cn("group flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg text-left font-semibold", triggerClassName)}>
        <span>{summary}</span>
        <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
