"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * #964: the measured content width of `ref`'s element, kept current with a
 * `ResizeObserver`. Returns `null` until the first measurement arrives, and
 * always where `ResizeObserver` does not exist (SSR, jsdom), so callers can
 * fall back to a viewport-based choice.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
