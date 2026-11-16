"use client";

import { useEffect } from "react";
import { compactScrollPaddingBottom } from "@/components/completion/pinnedReturn";

/**
 * #960: on phones the fixed bottom nav covers the bottom of the viewport, and
 * where the return button first lands depends on how tall the recap is. The
 * page is what scrolls, so its scroller gets the nav's clearance as scroll
 * padding: anything that scrolls a recap control into view then stops it
 * above the nav. A scroll margin on the button itself (#479) was not enough,
 * because WebKit ignores it when it brings the button into view.
 *
 * `pinned` is whether the bottom return button is pinned above the nav (#979),
 * which adds its extra clearance. It is false where the pin does not engage.
 */
export function useCompactScrollPadding(compact: boolean, pinned: boolean): void {
  useEffect(() => {
    if (!compact) return;
    const root = document.documentElement;
    const previous = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = compactScrollPaddingBottom(pinned);
    return () => {
      root.style.scrollPaddingBottom = previous;
    };
  }, [compact, pinned]);
}
