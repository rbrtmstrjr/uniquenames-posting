import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button as ShadcnButton } from "@/components/ui/shadcn/button";

// Our Button API (variant primary/subtle/ghost/danger, size sm/md/lg/icon, loading) on top of the
// shadcn Button. shadcn's own variant/size are switched off (null) so only our warm classes apply;
// every size keeps the 44px minimum touch target.
type Variant = "primary" | "subtle" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; loading?: boolean }

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90 shadow-soft",
  subtle: "bg-surface-2 text-ink hover:bg-accent-soft",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-bad/10 text-bad hover:bg-bad/15",
};
const SIZE: Record<Size, string> = { sm: "min-h-11 px-3 text-sm rounded-lg", md: "min-h-11 px-4 text-sm rounded-xl", lg: "min-h-12 px-5 text-base rounded-xl", icon: "size-11 p-0 rounded-xl" };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...rest }, ref,
) {
  return (
    <ShadcnButton ref={ref} type={type} disabled={disabled || loading} variant={null} size={null} aria-busy={loading || undefined}
      // Keep the pre-shadcn layout behaviour: labels may wrap and buttons may shrink in tight rows.
      className={cn("shrink gap-2 whitespace-normal font-semibold transition active:scale-[.98] disabled:opacity-55", VARIANT[variant], SIZE[size], className)}
      {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </ShadcnButton>
  );
});
