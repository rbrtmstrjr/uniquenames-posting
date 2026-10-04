"use client";
import { useEffect, useRef } from "react";

// Single-key shortcuts on desktop; ignored while typing in a field.
export function useHotkey(key: string, handler: () => void) {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => {
    const want = key.toLowerCase();
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      if (e.key.toLowerCase() === want) { e.preventDefault(); ref.current(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [key]);
}
