/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SoundPrefs } from "@/lib/audio";
import type { FocusSessionResult } from "@/lib/focusActivity";
import { HAPTIC_PATTERNS } from "@/lib/haptics";

/**
 * #836 — the focus activity timer. Every cue is recorded at the boundary it
 * leaves the app (an audio call, a `navigator.vibrate` pattern), stamped with
 * the fake clock, so "silent while running" is checked against what a person
 * would actually hear and feel.
 */

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const env = vi.hoisted(() => {
  const state = {
    t0: 0,
    log: [] as string[],
    keepAwakePref: true,
    /** Every `useWakeLock(enabled)` call, in render order. */
    wakeLock: [] as boolean[],
    /** Every `useSessionSuppressionRelay(active, key)` call, in render order. */
    suppression: [] as Array<{ active: boolean; key: string }>,
  };
  const record = (what: string) => {
    state.log.push(`${((Date.now() - state.t0) / 1000).toFixed(2)} ${what}`);
  };
  const play = (name: string) => {
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
    cancelVoiceCountdownPlayback: () => {},
    resumeAudioContext: () => Promise.resolve(true),
    subscribeAudioContextState: () => () => {},
    unlockAudioContext: () => {
      env.record("unlock");
      return Promise.resolve("unlocked" as const);
    },
  };
});

vi.mock("@/lib/useWakeLock", () => ({
  useKeepScreenAwakePref: () => env.state.keepAwakePref,
  useWakeLock: (enabled: boolean) => {
    env.state.wakeLock.push(enabled);
  },
}));

vi.mock("@/lib/useSessionSuppression", () => ({
  useSessionSuppressionRelay: (active: boolean, key: string) => {
    env.state.suppression.push({ active, key });
  },
}));

const { FocusActivityView, unlockFocusCompletionAudio } = await import("./FocusActivityView");

type Props = ComponentProps<typeof FocusActivityView>;

const T0 = new Date("2026-10-26T12:00:00.000Z");

/** The shipped defaults: tick and chime on, which the focus timer must still never play. */
const DEFAULT_PREFS: SoundPrefs = {
  tick: true,
  chime: true,
  completion: true,
  voiceCountdown: false,
  haptics: false,
  hapticInterval: "minute",
};

function savePrefs(overrides: Partial<SoundPrefs>) {
  localStorage.setItem("stillpoint_sound_prefs", JSON.stringify({ ...DEFAULT_PREFS, ...overrides }));
}

function hapticName(pattern: VibratePattern): string {
  const shape = JSON.stringify(Array.isArray(pattern) ? pattern : [pattern]);
  for (const [cue, cuePattern] of Object.entries(HAPTIC_PATTERNS)) {
    if (JSON.stringify(cuePattern) === shape) return `haptic:${cue}`;
  }
  return `haptic:${shape}`;
}

const liveRoots: Array<{ unmount: () => Promise<void> }> = [];

async function mount(overrides: Partial<Props> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const ends: Array<FocusSessionResult | null> = [];
  let props: Props = {
    goalSeconds: 120,
    onEnd: (result) => {
      env.record("end");
      ends.push(result);
    },
    ...overrides,
  };
  const render = async () => {
    await act(async () => {
      root?.render(createElement(FocusActivityView, props));
    });
  };
  await act(async () => {
    root = createRoot(container);
  });
  await render();
  const view = {
    container,
    ends,
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

/** Moves the wall clock without firing anything, as a suspended tab would see it. */
function setClock(seconds: number) {
  vi.setSystemTime(T0.getTime() + seconds * 1000);
}

function digits(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[data-testid='focus-remaining']");
  if (!(el instanceof HTMLElement)) throw new Error("missing countdown digits");
  return el;
}

function goalLabel(container: HTMLElement): string {
  return container.querySelector("[data-testid='focus-goal']")?.textContent ?? "";
}

async function pressEnd(container: HTMLElement) {
  const button = container.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("missing End button");
  await act(async () => {
    button.click();
  });
}

function cueNames(): string[] {
  return env.state.log.map(entry => entry.slice(entry.indexOf(" ") + 1));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  env.state.t0 = T0.getTime();
  env.state.log.length = 0;
  env.state.keepAwakePref = true;
  env.state.wakeLock.length = 0;
  env.state.suppression.length = 0;
  localStorage.clear();
  // Hidden keeps `useAudioContextResume`'s own resume attempts quiet.
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
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

describe("FocusActivityView — silent countdown (#836)", () => {
  it("plays no tick, chime, voice countdown or buzz while it runs, even with them all on", async () => {
    savePrefs({ tick: true, chime: true, voiceCountdown: true, haptics: true, hapticInterval: "tenSeconds" });
    const view = await mount({ goalSeconds: 120 });

    await advance(119_000);

    expect(env.state.log).toEqual([]);
    expect(digits(view.container).textContent).toBe("0:01");
    expect(view.ends).toEqual([]);
  });

  it("counts down from the goal in whole seconds off the wall clock", async () => {
    const view = await mount({ goalSeconds: 120 });
    expect(digits(view.container).textContent).toBe("2:00");

    await advance(1_000);
    expect(digits(view.container).textContent).toBe("1:59");

    // A tab suspended for a minute catches up on its next tick.
    setClock(61.5);
    await advance(250);
    expect(digits(view.container).textContent).toBe("0:59");
  });
});

describe("FocusActivityView — reaching the goal (#836)", () => {
  it("reports one completed session and announces it per the person's settings", async () => {
    savePrefs({ completion: true, tick: false, haptics: true });
    const view = await mount({ goalSeconds: 120 });

    await advance(120_000);

    expect(view.ends).toEqual([{ duration: 120, actualTime: 120, completed: true }]);
    expect(cueNames()).toEqual(["haptic:sessionEnd", "completion", "end"]);
    expect(digits(view.container).textContent).toBe("0:00");

    // The view stays up while the parent saves; nothing reports or plays again.
    await advance(10_000);
    expect(view.ends).toHaveLength(1);
    expect(cueNames()).toEqual(["haptic:sessionEnd", "completion", "end"]);
  });

  it("is silent at the end too when the completion sound and haptics are off", async () => {
    savePrefs({ completion: false, haptics: false });
    const view = await mount({ goalSeconds: 60 });

    await advance(60_000);

    expect(view.ends).toEqual([{ duration: 60, actualTime: 60, completed: true }]);
    expect(cueNames()).toEqual(["end"]);
  });

  it("an expiry noticed late still saves the goal and announces it once", async () => {
    const view = await mount({ goalSeconds: 120 });

    setClock(600);
    await advance(250);

    expect(view.ends).toEqual([{ duration: 120, actualTime: 120, completed: true }]);
    expect(cueNames().filter(name => name === "completion")).toHaveLength(1);
  });
});

describe("FocusActivityView — End (#836)", () => {
  it("ending early reports the whole seconds spent, not completed, and plays nothing", async () => {
    const view = await mount({ goalSeconds: 120 });

    await advance(20_400);
    await pressEnd(view.container);

    expect(view.ends).toEqual([{ duration: 120, actualTime: 20, completed: false }]);
    expect(cueNames()).toEqual(["end"]);
  });

  it("End before a whole second has passed reports nothing to save", async () => {
    const view = await mount({ goalSeconds: 120 });

    await advance(500);
    await pressEnd(view.container);

    expect(view.ends).toEqual([null]);
  });

  it("a second End, or the countdown running out afterwards, reports nothing more", async () => {
    const view = await mount({ goalSeconds: 60 });

    await advance(30_000);
    await pressEnd(view.container);
    await pressEnd(view.container);
    await advance(60_000);

    expect(view.ends).toEqual([{ duration: 60, actualTime: 30, completed: false }]);
    expect(cueNames()).toEqual(["end"]);
  });

  it("End that lands once the goal has passed counts as reaching it, without the cue", async () => {
    const view = await mount({ goalSeconds: 60 });

    // The deadline passed before any tick could notice it (a suspended tab).
    setClock(75);
    await pressEnd(view.container);
    await advance(1_000);

    expect(view.ends).toEqual([{ duration: 60, actualTime: 60, completed: true }]);
    expect(cueNames()).toEqual(["end"]);
  });
});

describe("FocusActivityView — the session environment (#836)", () => {
  it("keeps the screen awake and holds notifications only while it runs", async () => {
    const view = await mount({ goalSeconds: 60 });

    expect(env.state.wakeLock.at(-1)).toBe(true);
    expect(env.state.suppression.at(-1)?.active).toBe(true);

    await advance(10_000);
    await pressEnd(view.container);

    expect(env.state.wakeLock.at(-1)).toBe(false);
    expect(env.state.suppression.at(-1)?.active).toBe(false);
    // One hold key for the whole mount, so ending releases this session's hold.
    expect(new Set(env.state.suppression.map(call => call.key)).size).toBe(1);
  });

  it("leaves the screen alone when keep-awake is turned off in Settings", async () => {
    env.state.keepAwakePref = false;
    await mount({ goalSeconds: 60 });

    expect(env.state.wakeLock.every(enabled => !enabled)).toBe(true);
    expect(env.state.suppression.at(-1)?.active).toBe(true);
  });
});

// The digit size itself is `focusCountdownFontSize` (see focusActivity.test.ts):
// jsdom drops CSS `min()` values, so it cannot be read back from the DOM here.
describe("FocusActivityView — legible from one minute to two hours (#836)", () => {
  it("one minute", async () => {
    const view = await mount({ goalSeconds: 60 });
    expect(digits(view.container).textContent).toBe("1:00");
    expect(goalLabel(view.container)).toBe("focus · 1 min");
  });

  it("thirty minutes", async () => {
    const view = await mount({ goalSeconds: 1800 });
    expect(digits(view.container).textContent).toBe("30:00");
    expect(goalLabel(view.container)).toBe("focus · 30 min");
  });

  it("two hours: an hour field until the last hour, then m:ss", async () => {
    const view = await mount({ goalSeconds: 7200 });
    expect(digits(view.container).textContent).toBe("2:00:00");
    expect(goalLabel(view.container)).toBe("focus · 2 hr");

    setClock(3600.5);
    await advance(250);
    expect(digits(view.container).textContent).toBe("1:00:00");

    await advance(1_000);
    expect(digits(view.container).textContent).toBe("59:59");
  });

  it("keeps the goal it opened with when the parent's goal changes mid-session", async () => {
    const view = await mount({ goalSeconds: 60 });

    await view.rerender({ goalSeconds: 120 });
    await advance(60_000);

    expect(view.ends).toEqual([{ duration: 60, actualTime: 60, completed: true }]);
    expect(goalLabel(view.container)).toBe("focus · 1 min");
  });
});

describe("unlockFocusCompletionAudio (#836)", () => {
  it("unlocks audio from the opening tap when the completion sound is on", () => {
    savePrefs({ completion: true });
    unlockFocusCompletionAudio();
    expect(cueNames()).toEqual(["unlock"]);
  });

  it("leaves audio alone when the completion sound is off", () => {
    savePrefs({ completion: false });
    unlockFocusCompletionAudio();
    expect(cueNames()).toEqual([]);
  });
});
