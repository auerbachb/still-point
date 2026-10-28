/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/testing/blockTimerAudio";
import {
  advance,
  advanceSettling,
  clearLog,
  log,
  mount,
  prefs,
  resetBlockTimerHarness,
  teardownBlockTimerHarness,
  TICK_ONLY,
} from "@/lib/testing/blockTimerHarness";

/**
 * #732 / #1143 — sounds a suspended audio context blocked: when they replay,
 * and when the consumer hears about it.
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

describe("BlockTimer sound recovery", () => {
  it("replays a sound that failed once the context resumes", async () => {
    env.failures.set("tick", 1);
    await mount({ totalSeconds: 300, soundPrefs: TICK_ONLY });

    await advanceSettling(1_000);

    expect(log()).toEqual(["0.05 tick blocked", "0.05 resume", "0.05 tick", "0.05 resumed", "1.00 tick"]);
  });

  it("reports the block only once the resume attempt has failed", async () => {
    env.failures.set("tick", 1);
    env.resume = () => Promise.resolve(false);
    await mount({ totalSeconds: 300, soundPrefs: TICK_ONLY });

    await advanceSettling(1_000);

    expect(log()).toEqual(["0.05 tick blocked", "0.05 resume", "0.05 blocked", "1.00 tick"]);
  });

  it("replays only the latest failure while a resume is in flight", async () => {
    let release: (resumed: boolean) => void = () => {};
    await mount({ totalSeconds: 130, soundPrefs: prefs({ chime: true }) });
    await advance(59_000);
    clearLog();

    env.failures.set("tick", 1);
    env.failures.set("chime", 1);
    env.resume = () => new Promise<boolean>(resolve => {
      release = resolve;
    });
    await advanceSettling(1_000);
    await act(async () => {
      release(true);
    });

    expect(log()).toEqual([
      "60.00 tick blocked",
      "60.00 resume",
      "60.00 chime blocked",
      "60.00 chime",
      "60.00 resumed",
    ]);
  });

  it("retries a failed completion bell after the sit has ended", async () => {
    env.failures.set("completion", 1);
    await mount({ totalSeconds: 5, soundPrefs: prefs({ tick: false, completion: true }) });

    await advanceSettling(6_000);

    expect(log()).toEqual([
      "5.00 completion blocked",
      "5.00 resume",
      "5.00 complete",
      "5.00 completion",
      "5.00 resumed",
    ]);
  });

  // #844: a solo sit keeps the timer mounted while it saves, after the sit has
  // ended. A retry failing in that window must not raise the banner either.
  it("says nothing to the consumer when a retry fails after the sit has ended", async () => {
    env.failures.set("completion", 2);
    env.resume = () => Promise.resolve(false);
    const view = await mount({ totalSeconds: 5, soundPrefs: prefs({ tick: false, completion: true }) });

    await advanceSettling(6_000);
    await view.rerender({ isActive: false });
    await advanceSettling(1_000);

    expect(log()).toEqual([
      "5.00 completion blocked",
      "5.00 resume",
      "5.00 complete",
      "6.00 cancelVoice",
      "6.00 cancelVoice",
    ]);
  });

  it("says nothing to the consumer once unmounted, but still replays the sound", async () => {
    let release: (resumed: boolean) => void = () => {};
    env.failures.set("tick", 2);
    env.resume = () => new Promise<boolean>(resolve => {
      release = resolve;
    });
    const first = await mount({ totalSeconds: 300, soundPrefs: TICK_ONLY });
    await advanceSettling(50);
    await first.unmount();
    await act(async () => {
      release(false);
    });

    expect(log()).toEqual(["0.05 tick blocked", "0.05 resume", "0.05 cancelVoice"]);

    clearLog();
    const second = await mount({ totalSeconds: 300, soundPrefs: TICK_ONLY });
    await advanceSettling(50);
    await second.unmount();
    await act(async () => {
      release(true);
    });

    expect(log()).toEqual(["0.10 tick blocked", "0.10 resume", "0.10 cancelVoice", "0.10 tick"]);
  });
});
