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
 * The clearance the pinned button needs above the nav: its rendered height plus
 * its top margin. Text zoom or wrapping can make the button taller than its
 * 44px minimum, so this is measured rather than assumed.
 */
export function pinnedClearancePx(buttonHeight: number, buttonMarginTop: number): number {
  return Math.ceil(buttonHeight + buttonMarginTop);
}

/** Clearance used before the button has been measured: its 44px minimum plus 8px margin. */
export const PINNED_CLEARANCE_FALLBACK_PX = 52;

/**
 * Scroll padding for the compact recap. The nav's clearance is always
 * reserved. The pinned button's measured clearance is reserved only while the
 * button is actually pinned above the nav.
 */
export function compactScrollPaddingBottom(pinned: boolean, measuredPinPx?: number): string {
  const navClearance = "var(--nav-h) + env(safe-area-inset-bottom, 0px)";
  if (!pinned) return `calc(${navClearance})`;
  const extra = measuredPinPx ?? PINNED_CLEARANCE_FALLBACK_PX;
  return `calc(${navClearance} + ${extra}px)`;
}
