import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { BlockTimer } from "@/components/BlockTimer";
import type { SoundPrefs } from "@/lib/audio";
import { HAPTIC_PATTERNS } from "@/lib/haptics";
import { env, record } from "./blockTimerAudio";

/**
 * Shared harness for the `src/components/BlockTimer.*.test.ts` files (#1143).
 *
 * #732 — characterization tests for the session timer. Written against the
 * component *before* its clock and cue logic moved into `src/lib`, so they pin
 * what a sitter hears and feels — not how the component is put together.
 *
 * The suite is split by concern so a change to one kind of cue touches one
 * file. Every file still needs, at its top:
 *
 * - `/** @vitest-environment jsdom *\/`
 * - the `vi.mock("@/lib/audio", …)` call shown in `blockTimerAudio.ts`
 *   (a `vi.mock` only hoists in the test file)
 * - `beforeEach(resetBlockTimerHarness)` and `afterEach(teardownBlockTimerHarness)`
 *
 * A file that sets up failures or a resume outcome imports `env` straight from
 * `blockTimerAudio.ts`, not through this module: the mock factory loads that
 * module mid-import, and a re-export from here would wait on it.
 */

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Props = ComponentProps<typeof BlockTimer>;

export const T0 = new Date("2026-10-26T12:00:00.000Z");

export const TICK_ONLY: SoundPrefs = {
  tick: true,
  chime: false,
  completion: false,
  voiceCountdown: false,
  haptics: false,
  hapticInterval: "minute",
};

export function prefs(overrides: Partial<SoundPrefs>): SoundPrefs {
  return { ...TICK_ONLY, ...overrides };
}

export function setVisibility(state: DocumentVisibilityState) {
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

export async function mount(overrides: Partial<Props>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  let props: Props = {
    totalSeconds: 130,
    isActive: true,
    onComplete: () => record("complete"),
    mindState: "clear",
    mindStateLog: [],
    onSoundPlaybackBlocked: () => record("blocked"),
    onSoundPlaybackResumed: () => record("resumed"),
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
export async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * Runs the fake clock forward, settling promises between interval ticks, so a
 * resume attempt resolves at the tick that started it. Slower — keep it short.
 */
export async function advanceSettling(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Moves the fake clock without firing anything (controlled timers own no interval). */
export function setClock(seconds: number) {
  vi.setSystemTime(T0.getTime() + seconds * 1000);
}

export function log(): string[] {
  return [...env.log];
}

/** Forgets every cue recorded so far, so a test can check only what follows. */
export function clearLog() {
  env.log.length = 0;
}

/** The log without the per-second tick, which would drown every other cue. */
export function cues(): string[] {
  return log().filter(entry => !entry.endsWith(" tick"));
}

export function ticks(): string[] {
  return log()
    .filter(entry => entry.endsWith(" tick"))
    .map(entry => entry.slice(0, -" tick".length));
}

/** Whole-second stamps `from`..`to`, as the log writes them. */
export function seconds(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => (from + i).toFixed(2));
}

export function names(entries: string[]): string[] {
  return entries.map(entry => entry.slice(entry.indexOf(" ") + 1));
}

export function digits(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[data-session-timer-digits]");
  if (!(el instanceof HTMLElement)) throw new Error("missing timer digits");
  return el;
}

export function blockLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("div"))
    .filter(el => el.children.length === 0 && /^\d+[ms]$/.test(el.textContent ?? ""))
    .map(el => el.textContent ?? "");
}

/** Fake clock at `T0`, an empty log, and the browser surfaces the timer reads. */
export function resetBlockTimerHarness() {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  env.t0 = T0.getTime();
  env.log.length = 0;
  env.failures.clear();
  env.resume = () => Promise.resolve(true);
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
      record(hapticName(pattern));
      return true;
    },
  });
}

/** Unmounts every timer a test left mounted and hands back the real clock. */
export async function teardownBlockTimerHarness() {
  for (const view of liveRoots.splice(0)) {
    await view.unmount();
  }
  vi.useRealTimers();
}
