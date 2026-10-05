"use client";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Dialog as Root, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/shadcn/dialog";

// Our Dialog API on the shadcn Dialog: a bottom sheet on phones, a centered dialog on desktop.
// The class overrides undo shadcn's always-centered layout below the `sm` breakpoint.
export function Dialog({ open, onOpenChange, title, description, wide, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <Root open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} overlayClassName="bg-black/45 backdrop-blur-[2px]"
        // Without a description Radix warns unless aria-describedby is explicitly undefined.
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "block gap-0 inset-x-0 top-auto bottom-0 translate-x-0 translate-y-0 max-w-none w-auto max-h-[92dvh] overflow-y-auto rounded-t-3xl rounded-b-none border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-soft",
          "max-sm:data-[state=open]:slide-in-from-bottom-8 max-sm:data-[state=closed]:slide-out-to-bottom-8",
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,560px)] sm:max-w-none sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          wide && "sm:w-[min(94vw,920px)]")}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle className="font-display text-xl font-normal text-ink">{title}</DialogTitle>
            {description && <DialogDescription className="mt-1 text-sm text-muted">{description}</DialogDescription>}
          </div>
          <DialogClose className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close"><X className="size-5" /></DialogClose>
        </div>
        <div className="mt-4">{children}</div>
      </DialogContent>
    </Root>
  );
}
