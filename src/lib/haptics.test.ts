/**
 * #712 — vibration cues on web.
 *
 * The acceptance criteria are mostly about restraint: off by default, silent
 * when the pref is off, and a silent no-op on the many browsers with no
 * Vibration API at all. Most of what follows asserts that nothing happens.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  HAPTIC_PATTERNS,
  fireHaptic,
  maybeFireHaptic,
  supportsVibration,
} from "@/lib/haptics";

/** Installs a stub `navigator.vibrate`, or removes it to model Safari. */
function setVibrate(impl: ((pattern: number | number[]) => boolean) | null) {
  if (impl === null) {
    Reflect.deleteProperty(navigator, "vibrate");
    return;
  }
  Object.defineProperty(navigator, "vibrate", {
    value: impl,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  setVibrate(null);
  vi.restoreAllMocks();
});

describe("supportsVibration", () => {
  test("is false on a browser without the Vibration API", () => {
    setVibrate(null);
    expect(supportsVibration()).toBe(false);
  });

  test("is true once the API is present", () => {
    setVibrate(() => true);
    expect(supportsVibration()).toBe(true);
  });
});

describe("fireHaptic", () => {
  test("passes the cue's pattern to the browser", () => {
    const vibrate = vi.fn(() => true);
    setVibrate(vibrate);

    expect(fireHaptic("minuteMarker")).toBe(true);
    expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.minuteMarker]);
  });

  /**
   * Safari on every platform — including an iOS home-screen PWA — has no
   * Vibration API. Calling a cue there must be a silent no-op, not a crash
   * partway through a sit.
   */
  test("no-ops where the Vibration API is absent", () => {
    setVibrate(null);
    expect(fireHaptic("sessionEnd")).toBe(false);
  });

  /** Some engines throw instead of returning false without user activation. */
  test("swallows a throwing vibrate rather than breaking the sit", () => {
    setVibrate(() => {
      throw new Error("no user activation");
    });
    expect(fireHaptic("minuteMarker")).toBe(false);
  });

  test("reports a browser that refuses the cue", () => {
    setVibrate(() => false);
    expect(fireHaptic("sessionEnd")).toBe(false);
  });
});

describe("maybeFireHaptic", () => {
  /** The headline requirement: haptics is opt-in. */
  test("stays silent when the preference is off", () => {
    const vibrate = vi.fn(() => true);
    setVibrate(vibrate);

    expect(maybeFireHaptic(false, "minuteMarker")).toBe(false);
    expect(maybeFireHaptic(undefined, "sessionEnd")).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  test("fires when the preference is on", () => {
    const vibrate = vi.fn(() => true);
    setVibrate(vibrate);

    expect(maybeFireHaptic(true, "sessionEnd")).toBe(true);
    expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.sessionEnd]);
  });

  /**
   * The pref arrives via `JSON.parse` of localStorage, so the boolean type is a
   * claim rather than a guarantee. A stored string `"false"` is truthy; an
   * opt-in that promises stillness has to read that as no.
   */
  test("stays silent for a stored value that is not literally true", () => {
    const vibrate = vi.fn(() => true);
    setVibrate(vibrate);

    for (const stored of ["false", "true", 1, 0, "", null, {}]) {
      expect(
        maybeFireHaptic(stored as unknown as boolean | undefined, "minuteMarker"),
      ).toBe(false);
    }
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe("patterns", () => {
  /**
   * The criterion the two cues exist for: with your eyes closed, the end of the
   * sit has to feel unmistakably unlike a minute mark.
   */
  test("the end of a sit never feels like a minute marker", () => {
    expect(HAPTIC_PATTERNS.sessionEnd).not.toEqual(HAPTIC_PATTERNS.minuteMarker);
  });

  test("a minute marker is the shorter, gentler of the two", () => {
    const total = (p: readonly number[]) => p.reduce((a, b) => a + b, 0);
    expect(total(HAPTIC_PATTERNS.minuteMarker)).toBeLessThan(
      total(HAPTIC_PATTERNS.sessionEnd),
    );
  });

  /** A minute marker that drones would be the disruption the ticket rules out. */
  test("every buzz stays short", () => {
    for (const pattern of Object.values(HAPTIC_PATTERNS)) {
      for (const ms of pattern) {
        expect(ms).toBeGreaterThan(0);
        expect(ms).toBeLessThanOrEqual(200);
      }
    }
  });
});
