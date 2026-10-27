/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SoundPrefs } from "@/lib/audio";
import { HAPTIC_PATTERNS } from "@/lib/haptics";

/**
 * #732 — characterization tests for the session timer.
 *
 * Written against the component *before* its clock and cue logic moved into
 * `src/lib`, so they pin what a sitter hears and feels — not how the component
 * is put together. Every cue is recorded at the boundary it leaves the app (an
 * audio call, a `navigator.vibrate` pattern, a consumer callback), stamped with
 * the fake clock, so the same log has to come out whichever module produces it.
 */

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const env = vi.hoisted(() => {
  const state = {
    t0: 0,
    log: [] as string[],
    /** Sound name → how many of its next plays fail (a suspended context). */
    failures: new Map<string, number>(),
    resume: (): Promise<boolean> => Promise.resolve(true),
  };
  const record = (what: string) => {
    state.log.push(`${((Date.now() - state.t0) / 1000).toFixed(2)} ${what}`);
  };
  const play = (name: string) => {
    const left = state.failures.get(name) ?? 0;
    if (left > 0) {
      state.failures.set(name, left - 1);
      record(`${name} blocked`);
      return false;
    }
    record(name);
    return true;
  };
  return { state, record, play };
});

vi.mock("@/lib/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audio")>();
  return {
    ...actual,
    playTick: () => env.play("tick"),
    playChime: () => env.play("chime"),
    playCompletion: () => env.play("completion"),
    playVoiceCountdown: (seconds: number) => env.play(`voice:${seconds}`),
    cancelVoiceCountdownPlayback: () => env.record("cancelVoice"),
    resumeAudioContext: () => {
      env.record("resume");
      return env.state.resume();
    },
    subscribeAudioContextState: () => () => {},
  };
});

const { BlockTimer } = await import("./BlockTimer");

type Props = ComponentProps<typeof BlockTimer>;

const T0 = new Date("2026-10-26T12:00:00.000Z");

const TICK_ONLY: SoundPrefs = {
  tick: true,
  chime: false,
  completion: false,
  voiceCountdown: false,
  haptics: false,
  hapticInterval: "minute",
};

function prefs(overrides: Partial<SoundPrefs>): SoundPrefs {
  return { ...TICK_ONLY, ...overrides };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function hapticName(pattern: VibratePattern): string {
  const shape = JSON.stringify(Array.isArray(pattern) ? pattern : [pattern]);
  for (const [cue, cuePattern] of Object.entries(HAPTIC_PATTERNS)) {
    if (JSON.stringify(cuePattern) === shape) return `haptic:${cue}`;
  }
  return `haptic:${shape}`;
}

const liveRoots: Array<{ unmount: () => Promise<void> }> = [];

async function mount(overrides: Partial<Props>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  let props: Props = {
    totalSeconds: 130,
    isActive: true,
    onComplete: () => env.record("complete"),
    mindState: "clear",
    mindStateLog: [],
    onSoundPlaybackBlocked: () => env.record("blocked"),
    onSoundPlaybackResumed: () => env.record("resumed"),
    ...overrides,
  };
  const render = async () => {
    await act(async () => {
      root?.render(createElement(BlockTimer, props));
    });
  };
  await act(async () => {
    root = createRoot(container);
  });
  await render();
  const view = {
    container,
    rerender: async (next: Partial<Props>) => {
      props = { ...props, ...next };
      await render();
    },
    unmount: async () => {
      const index = liveRoots.indexOf(view);
      if (index >= 0) liveRoots.splice(index, 1);
      await act(async () => {
        root?.unmount();
      });
      root = null;
      container.remove();
    },
  };
  liveRoots.push(view);
  return view;
}

/** Runs the fake clock forward; React renders once the whole stretch has run. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * Runs the fake clock forward, settling promises between interval ticks, so a
 * resume attempt resolves at the tick that started it. Slower — keep it short.
 */
async function advanceSettling(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Moves the fake clock without firing anything (controlled timers own no interval). */
function setClock(seconds: number) {
  vi.setSystemTime(T0.getTime() + seconds * 1000);
}

function log(): string[] {
  return [...env.state.log];
}

/** The log without the per-second tick, which would drown every other cue. */
function cues(): string[] {
  return log().filter(entry => !entry.endsWith(" tick"));
}

function ticks(): string[] {
  return log()
    .filter(entry => entry.endsWith(" tick"))
    .map(entry => entry.slice(0, -" tick".length));
}

/** Whole-second stamps `from`..`to`, as the log writes them. */
function seconds(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => (from + i).toFixed(2));
}

function names(entries: string[]): string[] {
  return entries.map(entry => entry.slice(entry.indexOf(" ") + 1));
}

function digits(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[data-session-timer-digits]");
  if (!(el instanceof HTMLElement)) throw new Error("missing timer digits");
  return el;
}

function blockLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("div"))
    .filter(el => el.children.length === 0 && /^\d+[ms]$/.test(el.textContent ?? ""))
    .map(el => el.textContent ?? "");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  env.state.t0 = T0.getTime();
  env.state.log.length = 0;
  env.state.failures.clear();
  env.state.resume = () => Promise.resolve(true);
  localStorage.clear();
  // Hidden keeps `useAudioContextResume`'s own resume attempts out of the log;
  // the lifecycle test turns visibility on to check that wiring.
  setVisibility("hidden");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    value: (pattern: VibratePattern) => {
      env.record(hapticName(pattern));
      return true;
    },
  });
});

afterEach(async () => {
  for (const view of liveRoots.splice(0)) {
    await view.unmount();
  }
  vi.useRealTimers();
});

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

    // The pause reset elapsed to zero, but the clock had run before, so the
    // restart seeds as a resume from 0 — second 0 is not ticked again.
    expect(ticks()).toEqual(["0.05", ...seconds(1, 4), ...seconds(7, 10)]);
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

describe("BlockTimer sound recovery", () => {
  it("replays a sound that failed once the context resumes", async () => {
    env.state.failures.set("tick", 1);
    await mount({ totalSeconds: 300, soundPrefs: TICK_ONLY });

    await advanceSettling(1_000);

    expect(log()).toEqual(["0.05 tick blocked", "0.05 resume", "0.05 tick", "0.05 resumed", "1.00 tick"]);
  });

  it("reports the block only once the resume attempt has failed", async () => {
    env.state.failures.set("tick", 1);
    env.state.resume = () => Promise.resolve(false);
    await mount({ totalSeconds: 300, soundPrefs: TICK_ONLY });

    await advanceSettling(1_000);

    expect(log()).toEqual(["0.05 tick blocked", "0.05 resume", "0.05 blocked", "1.00 tick"]);
  });

  it("replays only the latest failure while a resume is in flight", async () => {
    let release: (resumed: boolean) => void = () => {};
    await mount({ totalSeconds: 130, soundPrefs: prefs({ chime: true }) });
    await advance(59_000);
    env.state.log.length = 0;

    env.state.failures.set("tick", 1);
    env.state.failures.set("chime", 1);
    env.state.resume = () => new Promise<boolean>(resolve => {
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
    env.state.failures.set("completion", 1);
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

  it("says nothing to the consumer once unmounted, but still replays the sound", async () => {
    let release: (resumed: boolean) => void = () => {};
    env.state.failures.set("tick", 2);
    env.state.resume = () => new Promise<boolean>(resolve => {
      release = resolve;
    });
    const first = await mount({ totalSeconds: 300, soundPrefs: TICK_ONLY });
    await advanceSettling(50);
    await first.unmount();
    await act(async () => {
      release(false);
    });

    expect(log()).toEqual(["0.05 tick blocked", "0.05 resume", "0.05 cancelVoice"]);

    env.state.log.length = 0;
    const second = await mount({ totalSeconds: 300, soundPrefs: TICK_ONLY });
    await advanceSettling(50);
    await second.unmount();
    await act(async () => {
      release(true);
    });

    expect(log()).toEqual(["0.10 tick blocked", "0.10 resume", "0.10 cancelVoice", "0.10 tick"]);
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

    env.state.log.length = 0;
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

    expect(names(log())).toEqual(["voice:60", "voice:59", "voice:55", "voice:56", "voice:59"]);
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

describe("BlockTimer rendering", () => {
  it("draws minute blocks then the final minute in ten-second blocks", async () => {
    const { container } = await mount({ totalSeconds: 130, isActive: false });

    expect(digits(container).textContent).toBe("2:10");
    expect(blockLabels(container)).toEqual(["1m", "2m", "10s"]);
    expect(container.textContent).toContain("final minute");
  });

  it("draws a short sit as ten-second blocks only", async () => {
    const { container } = await mount({ totalSeconds: 60, isActive: false });

    expect(blockLabels(container)).toEqual(["10s", "20s", "30s", "40s", "50s", "60s"]);
    expect(container.textContent).not.toContain("final minute");
  });

  it("counts the digits down as the sit runs", async () => {
    const { container } = await mount({ totalSeconds: 130, soundPrefs: undefined });

    await advance(61_000);

    expect(digits(container).textContent).toBe("1:09");
  });

  it("hides and shows the digits and remembers the choice", async () => {
    const { container } = await mount({ totalSeconds: 130, isActive: false });
    const toggle = container.querySelector("button");
    if (!(toggle instanceof HTMLButtonElement)) throw new Error("missing toggle");

    expect(toggle.getAttribute("aria-label")).toBe("Hide numerical timer");
    await act(async () => {
      toggle.click();
    });

    expect(toggle.getAttribute("aria-label")).toBe("Show numerical timer");
    expect(digits(container).getAttribute("aria-hidden")).toBe("true");
    expect(JSON.parse(localStorage.getItem("stillpoint_display_prefs") ?? "{}")).toEqual({ showTimer: false });
  });

  it("renders only the digits in minimal view, even with the digits hidden", async () => {
    localStorage.setItem("stillpoint_display_prefs", JSON.stringify({ showTimer: false }));
    const { container } = await mount({ totalSeconds: 130, isActive: false, minimal: true });

    expect(container.querySelector("button")).toBeNull();
    expect(blockLabels(container)).toEqual([]);
    expect(digits(container).getAttribute("aria-hidden")).toBe("false");
    expect(container.textContent).not.toContain("final minute");
  });
});
