"use client";

import { useEffect, type RefObject } from "react";
import {
  compactScrollPaddingBottom,
  pinnedClearancePx,
} from "@/components/completion/pinnedReturn";

/**
 * #960: on phones the fixed bottom nav covers the bottom of the viewport, and
 * where the return button first lands depends on how tall the recap is. The
 * page is what scrolls, so its scroller gets the nav's clearance as scroll
 * padding: anything that scrolls a recap control into view then stops it
 * above the nav. A scroll margin on the button itself (#479) was not enough,
 * because WebKit ignores it when it brings the button into view.
 *
 * `pinned` is whether the bottom return button is pinned above the nav (#979).
 * When it is, the extra clearance is the button's measured height plus its top
 * margin, re-measured whenever the button resizes (text zoom, wrapping).
 */
export function useCompactScrollPadding(
  compact: boolean,
  pinned: boolean,
  buttonRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!compact) return;
    const root = document.documentElement;
    const previous = root.style.scrollPaddingBottom;

    const apply = () => {
      const button = buttonRef.current;
      let measured: number | undefined;
      if (pinned && button) {
        const marginTop = parseFloat(getComputedStyle(button).marginTop) || 0;
        measured = pinnedClearancePx(button.getBoundingClientRect().height, marginTop);
      }
      root.style.scrollPaddingBottom = compactScrollPaddingBottom(pinned, measured);
    };

    apply();
    const button = buttonRef.current;
    const observer =
      pinned && button && typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    if (button) observer?.observe(button);

    return () => {
      observer?.disconnect();
      root.style.scrollPaddingBottom = previous;
    };
  }, [compact, pinned, buttonRef]);
}
