/**
 * Issue #884 — a sit that has ended never pauses or resumes.
 *
 * The regression this locks down: after End Early, Abandon, or a sit that ran
 * out, `SessionView` left its "resume" button live while the save was in
 * flight, and a tap restarted the clock and cues, and could save a second sit.
 * `SessionView` has no component harness, so the rule it applies to that button
 * and to `togglePause` is tested here, as iOS tests `SessionTickLogic.canStart`
 * (#848).
 */
import { describe, expect, test } from "vitest";
import { canTogglePause } from "./sessionPauseToggle";

describe("canTogglePause (#884)", () => {
  // End Early, Abandon, and a sit that ran out all set `sessionFinished`.
  test("refuses once the sit has ended", () => {
    expect(canTogglePause({ sessionFinished: true })).toBe(false);
  });

  // Running or paused: pause, then resume from the paused time, as before.
  test("allows pause and resume while the sit has not ended", () => {
    expect(canTogglePause({ sessionFinished: false })).toBe(true);
  });
});
