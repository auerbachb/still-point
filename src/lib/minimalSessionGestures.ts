/**
 * #669: pure gesture rules for the minimal ("just the timer") session view.
 *
 * While minimal, the whole screen is the affordance:
 * - a plain tap/click restores the full session screen;
 * - a press held past {@link MINIMAL_VIEW_LONG_PRESS_MS} opens thought capture
 *   without leaving minimal view, so the core interaction is never blocked;
 * - a press that drags past {@link MINIMAL_VIEW_MOVE_TOLERANCE_PX} is a scroll or
 *   a stray swipe and does nothing.
 *
 * Kept separate from the component so the rules are unit-testable without a DOM.
 */

/** Hold duration that opens thought capture instead of exiting minimal view. */
export const MINIMAL_VIEW_LONG_PRESS_MS = 500;

/** Pointer travel (px) past which a press is treated as a drag/scroll, not a tap. */
export const MINIMAL_VIEW_MOVE_TOLERANCE_PX = 12;

export type MinimalViewPress = {
  /** The pointer that opened the press; later events from other fingers are ignored. */
  pointerId: number;
  x: number;
  y: number;
  /** Set once the long-press fired or the press was cancelled by movement. */
  consumed: boolean;
};

export function beginMinimalViewPress(pointerId: number, x: number, y: number): MinimalViewPress {
  return { pointerId, x, y, consumed: false };
}

/**
 * True when an event belongs to the pointer that started the press. Without this
 * a second finger's release would resolve the first finger's press and drop the
 * user out of minimal view mid-gesture.
 */
export function isPressPointer(press: MinimalViewPress | null, pointerId: number): boolean {
  return press !== null && press.pointerId === pointerId;
}

/** True when the pointer has travelled far enough to disqualify the press as a tap. */
export function pressMovedBeyondTolerance(
  press: MinimalViewPress,
  x: number,
  y: number,
  tolerancePx: number = MINIMAL_VIEW_MOVE_TOLERANCE_PX,
): boolean {
  return Math.hypot(x - press.x, y - press.y) > tolerancePx;
}

/**
 * What a pointerup should do. `"exit"` restores the full screen; `"none"` means
 * the press was already handled (long press) or disqualified (drag).
 */
export function resolveMinimalViewRelease(press: MinimalViewPress | null): "exit" | "none" {
  if (!press || press.consumed) return "none";
  return "exit";
}
