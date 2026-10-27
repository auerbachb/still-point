"use client";

import { useEffect } from "react";

/**
 * #960: on phones the fixed bottom nav covers the bottom of the viewport, and
 * where the return button first lands depends on how tall the recap is. The
 * page is what scrolls, so its scroller gets the nav's clearance as scroll
 * padding: anything that scrolls a recap control into view then stops it
 * above the nav. A scroll margin on the button itself (#479) was not enough,
 * because WebKit ignores it when it brings the button into view.
 */
export function useCompactScrollPadding(compact: boolean): void {
  useEffect(() => {
    if (!compact) return;
    const root = document.documentElement;
    const previous = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))";
    return () => {
      root.style.scrollPaddingBottom = previous;
    };
  }, [compact]);
}
