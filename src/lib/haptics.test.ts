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
  MINUTE_BURST,
  fireHaptic,
  hapticIntervalSeconds,
  layeredHapticCue,
  maybeFireHaptic,
  minuteBurstPattern,
  minuteBurstTapCount,
  nextRepeatingHaptic,
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

  /** #1175: pulse, marker, and end are pairwise distinct shapes. */
  test("no two cues share a pattern", () => {
    const shapes = Object.values(HAPTIC_PATTERNS).map((p) => p.join(","));
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  /** #1175: the marker got stronger; the old tiny tap became the every-second pulse. */
  test("the every-second pulse is short and the minute marker is clearly stronger", () => {
    const total = (p: readonly number[]) => p.reduce((a, b) => a + b, 0);
    expect(HAPTIC_PATTERNS.secondPulse).toEqual([30]);
    expect(total(HAPTIC_PATTERNS.minuteMarker)).toBeGreaterThanOrEqual(100);
    expect(total(HAPTIC_PATTERNS.minuteMarker)).toBeGreaterThan(
      total(HAPTIC_PATTERNS.secondPulse) * 3,
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

describe("repeating haptic interval", () => {
  test("60s fires on each completed minute, including sits that skipped minute blocks", () => {
    expect(
      nextRepeatingHaptic({
        elapsedSeconds: 60,
        durationSeconds: 120,
        intervalSeconds: 60,
        lastCompletedIndex: 0,
      }),
    ).toEqual({ completedIndex: 1, shouldFire: true });

    expect(
      nextRepeatingHaptic({
        elapsedSeconds: 60,
        durationSeconds: 90,
        intervalSeconds: 60,
        lastCompletedIndex: 0,
      }).shouldFire,
    ).toBe(true);
  });

  test("10s fires on each completed ten seconds", () => {
    const first = nextRepeatingHaptic({
      elapsedSeconds: 10,
      durationSeconds: 25,
      intervalSeconds: 10,
      lastCompletedIndex: 0,
    });
    expect(first).toEqual({ completedIndex: 1, shouldFire: true });
    expect(
      nextRepeatingHaptic({
        elapsedSeconds: 20,
        durationSeconds: 25,
        intervalSeconds: 10,
        lastCompletedIndex: first.completedIndex,
      }),
    ).toEqual({ completedIndex: 2, shouldFire: true });
  });

  test("a sit no longer than the interval does not repeat, and the end tick does not", () => {
    expect(
      nextRepeatingHaptic({
        elapsedSeconds: 60,
        durationSeconds: 60,
        intervalSeconds: 60,
        lastCompletedIndex: 0,
      }).shouldFire,
    ).toBe(false);
    expect(
      nextRepeatingHaptic({
        elapsedSeconds: 120,
        durationSeconds: 120,
        intervalSeconds: 60,
        lastCompletedIndex: 1,
      }).shouldFire,
    ).toBe(false);
  });

  test("a jump fires once and does not replay the marks it skipped", () => {
    const jumped = nextRepeatingHaptic({
      elapsedSeconds: 25,
      durationSeconds: 40,
      intervalSeconds: 10,
      lastCompletedIndex: 0,
    });
    expect(jumped).toEqual({ completedIndex: 2, shouldFire: true });
    expect(
      nextRepeatingHaptic({
        elapsedSeconds: 26,
        durationSeconds: 40,
        intervalSeconds: 10,
        lastCompletedIndex: jumped.completedIndex,
      }).shouldFire,
    ).toBe(false);
  });

  test("rejects intervals other than 1s, 10s, and 60s", () => {
    expect(
      nextRepeatingHaptic({
        elapsedSeconds: 30,
        durationSeconds: 90,
        intervalSeconds: 30,
        lastCompletedIndex: 0,
      }),
    ).toEqual({ completedIndex: 0, shouldFire: false });
  });
});

describe("every-second interval (#1175)", () => {
  test("accepts the one-second value and falls back to every minute otherwise", () => {
    expect(hapticIntervalSeconds("everySecond")).toBe(1);
    expect(hapticIntervalSeconds(1)).toBe(1);
    expect(hapticIntervalSeconds("tenSeconds")).toBe(10);
    expect(hapticIntervalSeconds("minute")).toBe(60);
    expect(hapticIntervalSeconds("everyHour")).toBe(60);
    expect(hapticIntervalSeconds(undefined)).toBe(60);
  });

  test("fires on each completed second", () => {
    const first = nextRepeatingHaptic({
      elapsedSeconds: 1,
      durationSeconds: 5,
      intervalSeconds: 1,
      lastCompletedIndex: 0,
    });
    expect(first).toEqual({ completedIndex: 1, shouldFire: true });
    expect(
      nextRepeatingHaptic({
        elapsedSeconds: 1.5,
        durationSeconds: 5,
        intervalSeconds: 1,
        lastCompletedIndex: 1,
      }),
    ).toEqual({ completedIndex: 1, shouldFire: false });
  });

  test("a jump fires once and does not replay", () => {
    const jumped = nextRepeatingHaptic({
      elapsedSeconds: 4.3,
      durationSeconds: 10,
      intervalSeconds: 1,
      lastCompletedIndex: 1,
    });
    expect(jumped).toEqual({ completedIndex: 4, shouldFire: true });
    expect(
      nextRepeatingHaptic({
        elapsedSeconds: 4.8,
        durationSeconds: 10,
        intervalSeconds: 1,
        lastCompletedIndex: jumped.completedIndex,
      }).shouldFire,
    ).toBe(false);
  });

  test("never lands on the end tick", () => {
    expect(
      nextRepeatingHaptic({
        elapsedSeconds: 5,
        durationSeconds: 5,
        intervalSeconds: 1,
        lastCompletedIndex: 4,
      }),
    ).toEqual({ completedIndex: 4, shouldFire: false });
  });

  test("off-minute, off-ten boundaries play each interval's own finest cue", () => {
    expect(layeredHapticCue(61, 300, 1)).toEqual({ cue: "secondPulse" });
    expect(layeredHapticCue(70, 300, 10)).toEqual({ cue: "minuteMarker" });
    expect(layeredHapticCue(60, 300, 60)).toEqual({ cue: "minuteBurst", taps: 4 });
  });
});

describe("layered haptics (#1179)", () => {
  test("a coincident boundary plays only the highest-priority cue", () => {
    // 4:00 left in a 10-minute sit: minute, ten-second, and second at once.
    for (const interval of [1, 10, 60]) {
      expect(layeredHapticCue(360, 600, interval)).toEqual({ cue: "minuteBurst", taps: 4 });
    }
    expect(layeredHapticCue(370, 600, 1)).toEqual({ cue: "minuteMarker" });
  });

  test("a coarser interval never plays the finer cues", () => {
    expect(layeredHapticCue(61, 600, 10)).toBeNull();
    expect(layeredHapticCue(70, 600, 60)).toBeNull();
    expect(layeredHapticCue(61, 600, 60)).toBeNull();
  });

  test("the burst taps once per whole minute left, uncapped, down to the final minute", () => {
    expect(layeredHapticCue(60, 3600, 60)).toEqual({ cue: "minuteBurst", taps: 59 });
    expect(layeredHapticCue(1800, 3600, 60)).toEqual({ cue: "minuteBurst", taps: 30 });
    expect(layeredHapticCue(3540, 3600, 1)).toEqual({ cue: "minuteBurst", taps: 1 });
    expect(layeredHapticCue(3550, 3600, 1)).toEqual({ cue: "minuteMarker" });
    expect(layeredHapticCue(3599, 3600, 1)).toEqual({ cue: "secondPulse" });
  });

  test("0:00 is the end, never a 0-tap burst", () => {
    for (const interval of [1, 10, 60]) {
      expect(layeredHapticCue(300, 300, interval)).toBeNull();
    }
  });

  test("a minute mark without a whole minute left falls through to the finer layers", () => {
    expect(layeredHapticCue(60, 90, 60)).toBeNull();
    expect(layeredHapticCue(60, 90, 10)).toEqual({ cue: "minuteMarker" });
    expect(layeredHapticCue(60, 90, 1)).toEqual({ cue: "minuteMarker" });
    expect(layeredHapticCue(60, 330, 60)).toEqual({ cue: "minuteBurst", taps: 4 });
  });

  test("tap count and spacing come from one tunable constant", () => {
    expect(MINUTE_BURST.maxTaps).toBeNull();
    expect(MINUTE_BURST.tapMs + MINUTE_BURST.gapMs).toBeGreaterThanOrEqual(100);
    expect(MINUTE_BURST.tapMs + MINUTE_BURST.gapMs).toBeLessThanOrEqual(150);
    expect(minuteBurstTapCount(30)).toBe(30);
    expect(minuteBurstTapCount(0)).toBe(0);
    expect(minuteBurstPattern(3)).toEqual([
      MINUTE_BURST.tapMs,
      MINUTE_BURST.gapMs,
      MINUTE_BURST.tapMs,
      MINUTE_BURST.gapMs,
      MINUTE_BURST.tapMs,
    ]);
    expect(minuteBurstPattern(1)).toEqual([MINUTE_BURST.tapMs]);
  });

  test("a burst vibrates its taps and stays unlike the end", () => {
    const vibrate = vi.fn(() => true);
    setVibrate(vibrate);
    expect(maybeFireHaptic(true, { cue: "minuteBurst", taps: 2 })).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(minuteBurstPattern(2));
    expect(minuteBurstPattern(2)).not.toEqual([...HAPTIC_PATTERNS.sessionEnd]);
  });
});
