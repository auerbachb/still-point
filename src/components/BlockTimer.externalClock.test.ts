/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advance,
  clearLog,
  cues,
  log,
  mount,
  names,
  prefs,
  resetBlockTimerHarness,
  seconds,
  setClock,
  T0,
  teardownBlockTimerHarness,
  TICK_ONLY,
  ticks,
} from "@/lib/testing/blockTimerHarness";

/**
 * #732 / #1143 — sits whose elapsed comes from outside the component: a buddy's
 * server clock, and a parent's controlled elapsed.
 *
 * Harness and conventions: `src/lib/testing/blockTimerHarness.ts`.
 */

// The fake audio boundary, shared with the harness (#1143): see `blockTimerAudio.ts`.
vi.mock("@/lib/audio", async (importOriginal) => {
  const { mockAudio } = await import("@/lib/testing/blockTimerAudio");
  return mockAudio(await importOriginal<typeof import("@/lib/audio")>());
});

beforeEach(resetBlockTimerHarness);
afterEach(teardownBlockTimerHarness);

describe("BlockTimer buddy sync clock", () => {
  const startedSecondsAgo = 65;

  function syncClock(serverOffsetMs = 0) {
    return {
      startedAt: new Date(T0.getTime() - startedSecondsAgo * 1000).toISOString(),
      serverNow: new Date(Date.now() + serverOffsetMs).toISOString(),
      durationSeconds: 600,
    };
  }

  it("joins mid-sit with the cues already behind it treated as played", async () => {
    const elapsed: number[] = [];
    await mount({
      totalSeconds: 600,
      syncClock: syncClock(),
      soundPrefs: prefs({ chime: true, haptics: true }),
      onElapsedChange: e => elapsed.push(e),
    });

    expect(elapsed).toEqual([0, 65]);
    await advance(56_000);

    // Sit second N is wall second N - 65.
    expect(ticks()).toEqual(seconds(1, 56));
    expect(cues()).toEqual(["55.00 chime", "55.00 haptic:minuteMarker"]);
  });

  it("follows the server clock between polls and completes once", async () => {
    const view = await mount({
      totalSeconds: 600,
      syncClock: syncClock(),
      soundPrefs: prefs({ completion: true }),
    });

    await advance(10_500);
    // A poll reports the server 5s ahead of this device: the sit jumps 5s and
    // the jump is ticked once, not five times.
    await view.rerender({ syncClock: syncClock(5_000) });
    await advance(1_000);

    expect(ticks()).toEqual([...seconds(1, 10), "10.55", "11.00"]);

    await advance(530_000);
    await view.rerender({ syncClock: syncClock(5_000) });
    await advance(5_000);

    expect(cues()).toEqual(["530.00 completion", "530.00 complete"]);
  });
});
describe("BlockTimer controlled elapsed", () => {
  it("plays cues from the parent's elapsed and re-arms them on a restart", async () => {
    const elapsed: number[] = [];
    const view = await mount({
      totalSeconds: 130,
      controlledElapsed: 0,
      soundPrefs: prefs({ chime: true, completion: true, haptics: true }),
      onElapsedChange: e => elapsed.push(e),
    });
    for (let s = 1; s <= 131; s++) {
      setClock(s);
      await view.rerender({ controlledElapsed: s });
    }
    expect(elapsed.at(-1)).toBe(130);

    expect(ticks()).toEqual(seconds(0, 129));
    expect(cues()).toEqual([
      "60.00 chime",
      "60.00 haptic:minuteMarker",
      "120.00 haptic:minuteMarker",
      "130.00 haptic:sessionEnd",
      "130.00 completion",
      "130.00 complete",
    ]);

    clearLog();
    for (let s = 0; s <= 130; s++) {
      setClock(s);
      await view.rerender({ controlledElapsed: s });
    }

    // A restart does not tick second 0 again — the run already did.
    expect(ticks()).toEqual(seconds(1, 129));
    expect(cues()).toEqual([
      "60.00 chime",
      "60.00 haptic:minuteMarker",
      "120.00 haptic:minuteMarker",
      "130.00 haptic:sessionEnd",
      "130.00 completion",
      "130.00 complete",
    ]);
  });

  it("does not re-announce a second when the parent steps back in the final minute", async () => {
    const view = await mount({
      totalSeconds: 100,
      controlledElapsed: 40,
      soundPrefs: prefs({ tick: false, voiceCountdown: true }),
    });
    for (const s of [41, 45, 43, 44, 30, 41]) {
      await view.rerender({ controlledElapsed: s });
    }

    // #844: the step back to 30 leaves the final minute, so "56" — possibly
    // still playing — is cancelled before the countdown re-arms.
    expect(names(log())).toEqual([
      "voice:60",
      "voice:59",
      "voice:55",
      "voice:56",
      "cancelVoice",
      "voice:59",
    ]);
  });

  it("cancels a spoken number in flight when a controlled sit restarts", async () => {
    const view = await mount({
      totalSeconds: 100,
      controlledElapsed: 95,
      soundPrefs: prefs({ tick: false, voiceCountdown: true }),
    });
    await view.rerender({ controlledElapsed: 0 });

    expect(names(log())).toEqual(["voice:5", "cancelVoice"]);
  });

  it("lets a buddy sync clock take precedence over controlled elapsed", async () => {
    await mount({
      totalSeconds: 600,
      controlledElapsed: 590,
      syncClock: {
        startedAt: new Date(T0.getTime() - 65_000).toISOString(),
        serverNow: T0.toISOString(),
        durationSeconds: 600,
      },
      soundPrefs: TICK_ONLY,
    });

    await advance(1_000);

    expect(ticks()).toEqual(["1.00"]);
  });
});
