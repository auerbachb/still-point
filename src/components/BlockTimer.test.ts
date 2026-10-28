/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advance,
  cues,
  log,
  mount,
  prefs,
  resetBlockTimerHarness,
  seconds,
  setVisibility,
  teardownBlockTimerHarness,
  TICK_ONLY,
  ticks,
} from "@/lib/testing/blockTimerHarness";

/**
 * #732 / #1143 — the sit's own clock: ticks, minute marks, pause and resume,
 * restarts, bonus time, and the audio wiring that follows `isActive`.
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

describe("BlockTimer local clock", () => {
  it("ticks each second, marks the first minute, and ends the sit once", async () => {
    await mount({
      totalSeconds: 130,
      soundPrefs: prefs({ chime: true, completion: true, haptics: true }),
    });

    await advance(140_000);

    expect(ticks()).toEqual(["0.05", ...seconds(1, 129)]);
    // 120s leaves under a full minute to go, so only the first block chimes.
    // The repeating buzz runs on its own interval and marks both minutes.
    expect(cues()).toEqual([
      "60.00 chime",
      "60.00 haptic:minuteMarker",
      "120.00 haptic:minuteMarker",
      "130.00 haptic:sessionEnd",
      "130.00 completion",
      "130.00 complete",
    ]);
    expect(log().slice(log().indexOf("60.00 tick"), log().indexOf("60.00 tick") + 3)).toEqual([
      "60.00 tick",
      "60.00 chime",
      "60.00 haptic:minuteMarker",
    ]);
  });

  it("reports elapsed to the parent, starting from zero", async () => {
    const elapsed: number[] = [];
    await mount({ totalSeconds: 30, soundPrefs: TICK_ONLY, onElapsedChange: e => elapsed.push(e) });

    expect(elapsed).toEqual([0]);
    await advance(1_000);
    expect(elapsed.at(-1)).toBe(1);
    await advance(40_000);
    expect(elapsed.at(-1)).toBe(30);
  });

  it("resumes after a pause without replaying or skipping a cue", async () => {
    const view = await mount({
      totalSeconds: 300,
      soundPrefs: prefs({ chime: true, haptics: true }),
    });

    await advance(30_500);
    await view.rerender({ isActive: false });
    await advance(20_000);
    await view.rerender({ isActive: true });
    await advance(30_000);

    // Paused at 30.5s of sit time for 20s of wall time: sit second N lands at
    // wall N + 20 once it resumes, and second 30 is not ticked a second time.
    expect(ticks()).toEqual(["0.05", ...seconds(1, 30), ...seconds(51, 80)]);
    expect(cues()).toEqual([
      "30.50 cancelVoice",
      "30.50 cancelVoice",
      "50.50 cancelVoice",
      "80.00 chime",
      "80.00 haptic:minuteMarker",
    ]);
  });

  it("starts over from zero when a finished sit is restarted", async () => {
    const elapsed: number[] = [];
    const view = await mount({
      totalSeconds: 5,
      soundPrefs: prefs({ completion: true }),
      onElapsedChange: e => elapsed.push(e),
    });

    await advance(6_000);
    expect(elapsed.at(-1)).toBe(5);
    await view.rerender({ isActive: false });
    await view.rerender({ isActive: true });
    await advance(6_000);

    // #844: the restart is a fresh sit, so its second 0 ticks as the first
    // run's did. It used to seed as a resume from 0 and skip that tick.
    expect(ticks()).toEqual(["0.05", ...seconds(1, 4), "6.05", ...seconds(7, 10)]);
    expect(cues()).toEqual([
      "5.00 completion",
      "5.00 complete",
      "6.00 cancelVoice",
      "6.00 cancelVoice",
      "6.00 cancelVoice",
      "11.00 completion",
      "11.00 complete",
    ]);
    expect(elapsed).toContain(0);
  });

  it("keeps a silent sit silent and still completes it", async () => {
    await mount({ totalSeconds: 30, soundPrefs: undefined });

    await advance(31_000);

    expect(log()).toEqual(["30.00 complete"]);
  });

  it("re-seeds the cues when bonus time extends the sit", async () => {
    const view = await mount({
      totalSeconds: 60,
      soundPrefs: prefs({ chime: true, completion: true, haptics: true }),
    });

    await advance(30_000);
    await view.rerender({ totalSeconds: 180 });
    await advance(151_000);

    expect(ticks()).toEqual(["0.05", ...seconds(1, 179)]);
    // At 60s the sit had become 180s long: the first minute block now exists
    // and two full minutes remain, so it chimes and buzzes like any other.
    expect(cues()).toEqual([
      "60.00 chime",
      "60.00 haptic:minuteMarker",
      "120.00 chime",
      "120.00 haptic:minuteMarker",
      "180.00 haptic:sessionEnd",
      "180.00 completion",
      "180.00 complete",
    ]);
  });
});
describe("BlockTimer lifecycle", () => {
  it("cancels voice playback when inactive and resumes audio only while active", async () => {
    setVisibility("visible");
    const view = await mount({ totalSeconds: 60, isActive: false, soundPrefs: TICK_ONLY });
    await advance(1_000);
    await view.rerender({ isActive: true });
    await advance(1_000);
    await view.unmount();

    expect(log()).toEqual([
      "0.00 cancelVoice",
      "1.00 cancelVoice",
      "1.00 resume",
      "1.05 tick",
      "2.00 tick",
      "2.00 cancelVoice",
    ]);
  });
});
