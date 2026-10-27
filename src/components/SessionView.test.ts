/** @vitest-environment jsdom */
/**
 * #892 — a combined sit (#769) on the session screen. Its planned length is
 * Track One's plus Track Two's, and every way out of it reports it as combined
 * on the primary track. An ordinary sit's payloads carry no `combined` key.
 * These drive the real component, read the countdown it shows, and press its
 * own buttons.
 */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The sit plays nothing here: these tests read what it reports, not what it sounds like.
vi.mock("@/lib/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audio")>();
  return {
    ...actual,
    playTick: () => true,
    playChime: () => true,
    playCompletion: () => true,
    playVoiceCountdown: () => true,
    preloadVoiceCountdown: () => Promise.resolve(),
    cancelVoiceCountdownPlayback: () => {},
    resumeAudioContext: () => Promise.resolve(true),
    subscribeAudioContextState: () => () => {},
    unlockAudioContext: () => Promise.resolve("unlocked" as const),
  };
});

vi.mock("@/lib/useWakeLock", () => ({
  useKeepScreenAwakePref: () => false,
  useWakeLock: () => {},
}));

vi.mock("@/lib/useSessionSuppression", () => ({
  useSessionSuppressionRelay: () => {},
}));

const { SessionView } = await import("./SessionView");

type Props = ComponentProps<typeof SessionView>;
type SitPayload = Parameters<Props["onComplete"]>[0];

const T0 = new Date("2026-10-26T12:00:00.000Z");

const liveRoots: Array<{ unmount: () => Promise<void> }> = [];

async function mount(overrides: Partial<Props> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const completed: SitPayload[] = [];
  const abandoned: SitPayload[] = [];
  const props: Props = {
    currentDay: 200,
    onComplete: (data) => {
      completed.push(data);
    },
    onAbandon: (data) => {
      abandoned.push(data);
    },
    ...overrides,
  };
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(SessionView, props));
  });
  const view = {
    container,
    completed,
    abandoned,
    unmount: async () => {
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

/** Track One past the cap (600 s) with Track Two on day 20 (250 s), on the primary track. */
const COMBINED: Partial<Props> = { combined: true, currentDay: 200, secondTrackDay: 20, track: "primary" };

function digits(container: HTMLElement): string {
  const el = container.querySelector("[data-session-timer-digits]");
  if (!(el instanceof HTMLElement)) throw new Error("missing timer digits");
  return el.textContent ?? "";
}

async function press(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing "${label}" button`);
  await act(async () => {
    button.click();
  });
}

/** Runs the fake clock forward; React renders once the whole stretch has run. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
  // Hidden keeps `useAudioContextResume`'s own resume attempts quiet.
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
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
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: () => true });
});

afterEach(async () => {
  for (const view of liveRoots.splice(0)) {
    await view.unmount();
  }
  vi.useRealTimers();
});

describe("SessionView — a combined sit's planned length (#892)", () => {
  it("plans Track One's length plus Track Two's, ignoring recovery", async () => {
    const view = await mount({
      ...COMBINED,
      // Recovery never applies to a combined sit: it is not offered during one.
      recovery: { recoveryTargetDay: 40, recoveryCurrentStep: 1, recoveryTotalSteps: 5 },
    });
    expect(digits(view.container)).toBe("14:10");
  });

  it("leaves an ordinary sit at its own track's length", async () => {
    const view = await mount({ currentDay: 200, secondTrackDay: 20 });
    expect(digits(view.container)).toBe("10:00");
  });

  it("adds bonus time on top of the combined length, as for any sit", async () => {
    const view = await mount(COMBINED);
    await press(view.container, "+1 min");
    expect(digits(view.container)).toBe("15:10");

    await press(view.container, "end early & keep");
    expect(view.completed[0]).toMatchObject({ duration: 850, bonusSeconds: 60 });
  });
});

describe("SessionView — what a combined sit reports (#892)", () => {
  it("run to the end, it reports one completed combined sit on the primary track", async () => {
    const view = await mount(COMBINED);

    await advance(850_000);

    expect(view.completed).toHaveLength(1);
    expect(view.completed[0]).toMatchObject({
      combined: true,
      sessionType: "standard",
      track: "primary",
      dayNumber: 200,
      duration: 850,
      completed: true,
    });
  });

  it("ended early, it reports combined with completed false", async () => {
    const view = await mount(COMBINED);
    await advance(30_000);

    await press(view.container, "end early & keep");

    expect(view.completed).toHaveLength(1);
    expect(view.completed[0]).toMatchObject({
      combined: true,
      track: "primary",
      dayNumber: 200,
      duration: 850,
      completed: false,
    });
  });

  it("abandoned, it reports combined too", async () => {
    const view = await mount(COMBINED);

    await press(view.container, "abandon");

    expect(view.abandoned).toHaveLength(1);
    expect(view.abandoned[0]).toMatchObject({ combined: true, track: "primary", dayNumber: 200, completed: false });
  });

  it("an ordinary sit's payloads have no combined key at all", async () => {
    const ended = await mount({ currentDay: 200 });
    await press(ended.container, "end early & keep");
    expect(ended.completed[0]).toMatchObject({ track: "primary", duration: 600, completed: false });
    expect(ended.completed[0]).not.toHaveProperty("combined");

    const left = await mount({ currentDay: 200 });
    await press(left.container, "abandon");
    expect(left.abandoned[0]).not.toHaveProperty("combined");
  });
});
