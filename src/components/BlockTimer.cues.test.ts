/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advance,
  cues,
  digits,
  mount,
  names,
  prefs,
  resetBlockTimerHarness,
  T0,
  teardownBlockTimerHarness,
  ticks,
} from "@/lib/testing/blockTimerHarness";

/**
 * #732 / #1143 — the cues that replace or repeat the minute mark: the spoken
 * countdown over the final minute, and the haptic interval.
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

describe("BlockTimer voice countdown", () => {
  it("counts down the final minute instead of ticking", async () => {
    await mount({
      totalSeconds: 75,
      soundPrefs: prefs({ tick: false, voiceCountdown: true, chime: true, completion: true }),
    });

    await advance(80_000);

    // #922: each second N is announced on the first update with N seconds or
    // fewer left, so "60" holds the whole first second of the final minute.
    const expectedVoice = Array.from({ length: 60 }, (_, i) => `${15 + i}.00 voice:${60 - i}`);
    expect(cues()).toEqual([...expectedVoice, "75.00 completion", "75.00 complete"]);
    expect(ticks()).toEqual([]);
  });

  // #922: the number heard is the number on screen as its clip starts, also
  // when the updates land off the whole second, as a real interval's do.
  it("shows the number each clip speaks as it starts", async () => {
    const { container } = await mount({
      totalSeconds: 75,
      soundPrefs: prefs({ tick: false, voiceCountdown: true }),
    });
    // Every update from here lands 3ms after its 50ms mark.
    vi.setSystemTime(T0.getTime() + 3);

    await advance(15_000);
    for (let second = 60; second >= 1; second--) {
      if (second < 60) await advance(1_000);
      // The last update of each stretch is the one that started this clip.
      expect(names(cues()).at(-1)).toBe(`voice:${second}`);
      expect(digits(container).textContent).toBe(
        `${Math.floor(second / 60)}:${String(second % 60).padStart(2, "0")}`,
      );
    }
    expect(names(cues())).toEqual(Array.from({ length: 60 }, (_, i) => `voice:${60 - i}`));
  });

  // #853: the chime keeps its own switch; only the one opening the final
  // minute gives way to the countdown.
  it("silences only the chime that opens the final minute, never the buzz", async () => {
    await mount({
      totalSeconds: 180,
      soundPrefs: prefs({ tick: false, voiceCountdown: true, chime: true, haptics: true }),
    });

    await advance(121_000);

    expect(cues()).toEqual([
      "60.00 chime",
      "60.00 haptic:minuteMarker",
      "120.00 voice:60",
      "120.00 haptic:minuteMarker",
      "121.00 voice:59",
    ]);
  });
});
describe("BlockTimer haptic interval", () => {
  it("buzzes every ten seconds, never on the end itself", async () => {
    await mount({
      totalSeconds: 60,
      soundPrefs: prefs({ tick: false, haptics: true, hapticInterval: "tenSeconds", chime: true }),
    });

    await advance(61_000);

    expect(cues()).toEqual([
      "10.00 haptic:minuteMarker",
      "20.00 haptic:minuteMarker",
      "30.00 haptic:minuteMarker",
      "40.00 haptic:minuteMarker",
      "50.00 haptic:minuteMarker",
      "60.00 haptic:sessionEnd",
      "60.00 complete",
    ]);
  });

  it("re-counts from the current position when the interval changes mid-sit", async () => {
    const view = await mount({
      totalSeconds: 300,
      soundPrefs: prefs({ tick: false, haptics: true }),
    });

    await advance(25_000);
    await view.rerender({ soundPrefs: prefs({ tick: false, haptics: true, hapticInterval: "tenSeconds" }) });
    await advance(40_000);
    await view.rerender({ soundPrefs: prefs({ tick: false, haptics: true }) });
    await advance(60_000);

    // No burst for the boundaries already behind the switch, in either direction.
    expect(cues()).toEqual([
      "30.00 haptic:minuteMarker",
      "40.00 haptic:minuteMarker",
      "50.00 haptic:minuteMarker",
      "60.00 haptic:minuteMarker",
      "120.00 haptic:minuteMarker",
    ]);
  });
});
