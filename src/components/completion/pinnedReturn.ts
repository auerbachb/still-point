/**
 * #979: the phone recap's bottom return button is pinned with
 * `position: sticky`, and sticky only engages against the viewport. The page
 * sets `overflow-x: clip` on html and body, which leaves body out of the
 * scroll-container set. A browser without `clip` falls back to `hidden`, which
 * makes body its own scroller, so the pin would never engage there.
 */
export function returnPinSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("overflow-x", "clip")
  );
}

/** The bottom button is pinned only on a compact layout where the pin engages. */
export function shouldPinReturnButton(compact: boolean, supported: boolean = returnPinSupported()): boolean {
  return compact && supported;
}

/**
 * Scroll padding for the compact recap. The nav's clearance is always
 * reserved. The pinned button's extra 52px (44px min height + 8px top margin)
 * is reserved only while the button is actually pinned above the nav.
 */
export function compactScrollPaddingBottom(pinned: boolean): string {
  const navClearance = "var(--nav-h) + env(safe-area-inset-bottom, 0px)";
  return pinned ? `calc(${navClearance} + 52px)` : `calc(${navClearance})`;
}
