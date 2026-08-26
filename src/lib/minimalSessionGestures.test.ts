/**
 * Issue #669 — gesture rules for the minimal ("just the timer") session view.
 *
 * While minimal the whole screen is the affordance, so the tap that restores the
 * session screen must not swallow thought capture (long press) or fire on a
 * scroll (drag).
 */
import { describe, expect, it } from "vitest";
import {
  MINIMAL_VIEW_LONG_PRESS_MS,
  MINIMAL_VIEW_MOVE_TOLERANCE_PX,
  beginMinimalViewPress,
  isPressPointer,
  pressMovedBeyondTolerance,
  resolveMinimalViewRelease,
} from "./minimalSessionGestures";

describe("minimal view gesture constants", () => {
  it("uses a long-press window long enough to distinguish it from a tap", () => {
    expect(MINIMAL_VIEW_LONG_PRESS_MS).toBeGreaterThanOrEqual(400);
    expect(MINIMAL_VIEW_MOVE_TOLERANCE_PX).toBeGreaterThan(0);
  });
});

describe("pressMovedBeyondTolerance", () => {
  it("treats a still finger as a tap", () => {
    const press = beginMinimalViewPress(1, 100, 200);
    expect(pressMovedBeyondTolerance(press, 100, 200)).toBe(false);
  });

  it("tolerates small jitter inside the threshold", () => {
    const press = beginMinimalViewPress(1, 100, 200);
    expect(pressMovedBeyondTolerance(press, 105, 203)).toBe(false);
  });

  it("rejects a press that travels past the threshold in either axis", () => {
    const press = beginMinimalViewPress(1, 100, 200);
    expect(pressMovedBeyondTolerance(press, 100, 240)).toBe(true);
    expect(pressMovedBeyondTolerance(press, 160, 200)).toBe(true);
  });

  it("measures diagonal travel, not per-axis travel", () => {
    const press = beginMinimalViewPress(1, 0, 0);
    // 10px on each axis is under tolerance per-axis but ~14.1px diagonally.
    expect(pressMovedBeyondTolerance(press, 10, 10)).toBe(true);
  });

  it("honours a caller-supplied tolerance", () => {
    const press = beginMinimalViewPress(1, 0, 0);
    expect(pressMovedBeyondTolerance(press, 30, 0, 40)).toBe(false);
  });
});

describe("isPressPointer", () => {
  it("matches only the pointer that opened the press", () => {
    const press = beginMinimalViewPress(7, 10, 10);
    expect(isPressPointer(press, 7)).toBe(true);
    // A second finger must not resolve the first finger's press.
    expect(isPressPointer(press, 8)).toBe(false);
  });

  it("matches nothing when no press is active", () => {
    expect(isPressPointer(null, 7)).toBe(false);
  });
});

describe("resolveMinimalViewRelease", () => {
  it("restores the full session screen after a plain tap", () => {
    const press = beginMinimalViewPress(1, 10, 10);
    expect(resolveMinimalViewRelease(press)).toBe("exit");
  });

  it("does nothing when the long press already opened thought capture", () => {
    const press = beginMinimalViewPress(1, 10, 10);
    press.consumed = true;
    expect(resolveMinimalViewRelease(press)).toBe("none");
  });

  it("does nothing when the press was disqualified by movement", () => {
    const press = beginMinimalViewPress(1, 10, 10);
    if (pressMovedBeyondTolerance(press, 10, 90)) press.consumed = true;
    expect(resolveMinimalViewRelease(press)).toBe("none");
  });

  it("does nothing for a release with no matching press", () => {
    expect(resolveMinimalViewRelease(null)).toBe("none");
  });
});
