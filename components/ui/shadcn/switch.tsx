"use client"

import * as React from "react"
import { cn } from "@/lib/utils/cn"
import { Switch as SwitchPrimitive } from "radix-ui"

// shadcn Switch, resized for touch (44×24 track) and recoloured with our warm tokens:
// the off track is our muted ink at 75% (about 3.4:1 on white, 3.8:1 on the dark surface).
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted/75",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 rounded-full bg-white shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-[21px] data-[state=unchecked]:translate-x-px dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-ink"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
