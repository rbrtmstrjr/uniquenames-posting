"use client";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";

// An image that fills its (already sized) parent: a shimmer shows until the picture has
// loaded, then it fades in. No `src` yet (signed URL still coming) also shows the shimmer,
// so a tile is never a blank square and nothing shifts when the picture arrives.
export function FadeImage({ src, alt = "", className, loading = "lazy" }: {
  src?: string; alt?: string; className?: string; loading?: "lazy" | "eager";
}) {
  // Track which src finished loading, so a new src (remade card) shimmers again.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loaded = !!src && loadedSrc === src;
  const failed = !!src && failedSrc === src;
  return (
    <>
      {!loaded && !failed && <div data-testid="image-skeleton" aria-hidden className="absolute inset-0 shimmer animate-shimmer" />}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt={alt} loading={loading} decoding="async"
          // A cached picture can finish before React attaches onLoad: catch it on mount.
          ref={(el) => { if (el?.complete && el.naturalWidth > 0 && loadedSrc !== src) setLoadedSrc(src); }}
          onLoad={() => setLoadedSrc(src)} onError={() => setFailedSrc(src)}
          data-loaded={loaded ? "true" : "false"}
          // Caller classes (dimmed/blurred states) apply once loaded; before that it stays invisible.
          className={cn("absolute inset-0 size-full object-cover transition duration-300", className, !loaded && "opacity-0")} />
      )}
    </>
  );
}
