import { cn } from "@/lib/utils/cn";

// The Facebook page's profile photo the way Facebook draws it: a circle in a solid Facebook-blue ring with a thin gap
// of the card's colour between ring and photo, and the scalloped blue verified badge (white check, white outline) at
// the bottom right. The ring is decorative (aria-hidden); the badge is labelled for screen readers.

export const FB_BLUE = "#1877F2";

const SIZES = {
  // ring 3px + gap 3px around the photo
  lg: { box: "size-[72px] p-[6px] md:size-[88px]", ring: "border-[3px]", badge: "-bottom-1 -right-1 size-7 md:size-8" },
  sm: { box: "size-8 p-[3px]", ring: "border-[1.5px]", badge: "" },
} as const;

export function FbAvatar({ src, alt, verified = false, size = "lg", className }: {
  src: string; alt: string; verified?: boolean; size?: keyof typeof SIZES; className?: string;
}) {
  const s = SIZES[size];
  return (
    <span data-fb-avatar className={cn("relative inline-block shrink-0 rounded-full", s.box, className)}>
      <span data-fb-ring aria-hidden="true" className={cn("absolute inset-0 rounded-full", s.ring)} style={{ borderColor: FB_BLUE }} />
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static WebP from public/ */}
      <img src={src} alt={alt} width={160} height={160} decoding="async" className="block size-full rounded-full object-cover" />
      {verified && size === "lg" && <VerifiedBadge className={cn("absolute", s.badge)} />}
    </span>
  );
}

// Facebook's verified mark: a 12-lobed blue rosette with a white check. Drawn twice: a white outline pass under the
// blue one, so it stays separate from any photo behind it.
const LOBES = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6;
  return { cx: +(12 + 7.4 * Math.cos(a)).toFixed(2), cy: +(12 + 7.4 * Math.sin(a)).toFixed(2) };
});

export function VerifiedBadge({ className, label = "Verified Facebook page", decorative = false }: { className?: string; label?: string; decorative?: boolean }) {
  return (
    <svg viewBox="-2 -2 28 28" className={className} {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}>
      {!decorative && <title>{label}</title>}
      <g fill="#FFFFFF" stroke="#FFFFFF" strokeWidth={3}>
        <circle cx={12} cy={12} r={7.6} />
        {LOBES.map((l, i) => <circle key={i} cx={l.cx} cy={l.cy} r={3.3} />)}
      </g>
      <g fill={FB_BLUE}>
        <circle cx={12} cy={12} r={7.6} />
        {LOBES.map((l, i) => <circle key={i} cx={l.cx} cy={l.cy} r={3.3} />)}
      </g>
      <path d="M7.6 12.3l3 3 5.8-6.1" fill="none" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
