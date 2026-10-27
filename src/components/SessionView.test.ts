/** @vitest-environment jsdom */
/**
 * #892 — a combined sit (#769) on the session screen. Its planned length is
 * Track One's plus Track Two's, and every way out of it reports it as combined
 * on the primary track. An ordinary sit's payloads carry no `combined` key.
 * #930 — a sit ends once: after it runs out, or after End Early or Abandon, a
 * further click on either button sends nothing, and no second sit is saved.
 * These drive the real component, read the countdown it shows, and press its
 * own buttons.
 */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/api";
import type { SavedSessionResult } from "@/lib/offlineSessionQueue/types";
import type { PracticeDaySit } from "@/lib/sessionCalendar";

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// #930: the queue behind the real save hook, for the tests that wire the sit
// to it the way the page does. Nothing else here reaches it.
const queue = vi.hoisted(() => ({
  saveCompletedSession: vi.fn(),
}));

vi.mock("@/lib/offlineSessionQueue", () => ({
  getWebSessionSyncCoordinator: () => queue,
}));

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
const { useSessionSaveLifecycle } = await import("@/lib/useSessionSaveLifecycle");

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

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing "${label}" button`);
  return found;
}

async function press(container: HTMLElement, label: string) {
  const target = button(container, label);
  await act(async () => {
    target.click();
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
  queue.saveCompletedSession.mockReset();
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

describe("SessionView — a sit ends once (#930)", () => {
  // The page closes the sit only once its save settles, so this screen stays
  // up meanwhile, both buttons on it. These callbacks only record, so that
  // window stays open for the whole test.

  it("End Early twice sends one onComplete", async () => {
    const view = await mount();

    await press(view.container, "end early & keep");
    await press(view.container, "end early & keep");

    expect(view.completed).toHaveLength(1);
    expect(view.completed[0]).toMatchObject({ completed: false });
    expect(view.abandoned).toHaveLength(0);
  });

  it("Abandon twice sends one onAbandon", async () => {
    const view = await mount();

    await press(view.container, "abandon");
    await press(view.container, "abandon");

    expect(view.abandoned).toHaveLength(1);
    expect(view.abandoned[0]).toMatchObject({ completed: false });
    expect(view.completed).toHaveLength(0);
  });

  it("Abandon after End Early sends nothing, nor End Early after Abandon", async () => {
    const ended = await mount();
    await press(ended.container, "end early & keep");
    await press(ended.container, "abandon");
    expect(ended.completed).toHaveLength(1);
    expect(ended.abandoned).toHaveLength(0);

    const left = await mount();
    await press(left.container, "abandon");
    await press(left.container, "end early & keep");
    expect(left.abandoned).toHaveLength(1);
    expect(left.completed).toHaveLength(0);
  });

  it("disables End Early and Abandon once the sit has ended", async () => {
    const view = await mount();
    expect(button(view.container, "end early & keep").disabled).toBe(false);
    expect(button(view.container, "abandon").disabled).toBe(false);

    await press(view.container, "end early & keep");

    expect(button(view.container, "end early & keep").disabled).toBe(true);
    expect(button(view.container, "abandon").disabled).toBe(true);
  });

  // `disabled` lands with the next render. Clicks that arrive before it are
  // turned away by the handlers themselves.
  it("clicks that land before the screen re-renders still send one", async () => {
    const view = await mount();
    const endEarly = button(view.container, "end early & keep");
    const abandon = button(view.container, "abandon");

    await act(async () => {
      endEarly.click();
      endEarly.click();
      abandon.click();
    });

    expect(view.completed).toHaveLength(1);
    expect(view.abandoned).toHaveLength(0);
  });

  it("after a sit runs out, End Early and Abandon are disabled and send nothing", async () => {
    // Day 1 is a 60 s sit.
    const view = await mount({ currentDay: 1 });
    await advance(60_000);
    expect(view.completed).toHaveLength(1);
    expect(view.completed[0]).toMatchObject({ completed: true });
    expect(button(view.container, "end early & keep").disabled).toBe(true);
    expect(button(view.container, "abandon").disabled).toBe(true);

    await press(view.container, "end early & keep");
    await press(view.container, "abandon");

    expect(view.completed).toHaveLength(1);
    expect(view.abandoned).toHaveLength(0);
  });

  it("an End Early in the instant the sit runs out sends nothing more", async () => {
    const view = await mount({ currentDay: 1 });
    await advance(59_000);
    const endEarly = button(view.container, "end early & keep");

    await act(async () => {
      // The sit runs out, and the click lands before the screen re-renders.
      vi.advanceTimersByTime(1_000);
      endEarly.click();
    });

    expect(view.completed).toHaveLength(1);
    expect(view.completed[0]).toMatchObject({ completed: true });
  });

  it("each sit sends a key of its own", async () => {
    const ended = await mount();
    await press(ended.container, "end early & keep");
    const left = await mount();
    await press(left.container, "abandon");
    const ranOut = await mount({ currentDay: 1 });
    await advance(60_000);

    const keys = [ended.completed[0]?.sitKey, left.abandoned[0]?.sitKey, ranOut.completed[0]?.sitKey];
    for (const key of keys) {
      expect(key).toEqual(expect.any(String));
    }
    expect(new Set(keys).size).toBe(3);
  });
});

/** Signed in, on day 5: a 100 s sit. */
const SITTER: User = {
  id: "user-1",
  email: "sitter@example.com",
  username: "sitter",
  isPublic: false,
  currentDay: 5,
  aphorismsEnabled: false,
};

function synced(sessionId: string): SavedSessionResult {
  return { sessionId, isPendingSync: false, serverSessionId: sessionId };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * #930: the sit as the page wires it — `SessionView` handing its sit straight to
 * the real save hook. `saves` keeps each handler's promise, which the page
 * drops, so a test can wait for a save it lets settle.
 */
async function mountOnSaveHook() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const setOverlay = vi.fn();
  const saves: Array<Promise<void>> = [];
  const sessionGeneration = { current: 0 };
  const loadedSitsRef: { current: PracticeDaySit[] | null } = { current: null };
  const userRef = { current: SITTER };

  function Sit() {
    const { handleSessionComplete, handleSessionAbandon } = useSessionSaveLifecycle({
      sessionGeneration,
      loadedSitsRef,
      user: SITTER,
      userRef,
      setUser: () => {},
      refreshUserFromServer: () => {},
      refreshTodayTracks: async () => {},
      setOverlay,
    });
    return createElement(SessionView, {
      currentDay: SITTER.currentDay,
      onComplete: (data) => {
        saves.push(handleSessionComplete(data));
      },
      onAbandon: (data) => {
        saves.push(handleSessionAbandon(data));
      },
    });
  }

  await act(async () => {
    root = createRoot(container);
    root.render(createElement(Sit));
  });
  const view = {
    container,
    setOverlay,
    saves,
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

describe("SessionView on the save hook — one sit, one save (#930)", () => {
  it("End Early twice, then Abandon, queues one sit while its save runs", async () => {
    queue.saveCompletedSession.mockReturnValue(new Promise(() => {}));
    const view = await mountOnSaveHook();

    await press(view.container, "end early & keep");
    await press(view.container, "end early & keep");
    await press(view.container, "abandon");

    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(1);
    expect(queue.saveCompletedSession.mock.calls[0]![0]).toMatchObject({ completed: false });
  });

  it("End Early twice and Abandon in one instant queue one sit", async () => {
    queue.saveCompletedSession.mockReturnValue(new Promise(() => {}));
    const view = await mountOnSaveHook();
    const endEarly = button(view.container, "end early & keep");
    const abandon = button(view.container, "abandon");

    await act(async () => {
      endEarly.click();
      endEarly.click();
      abandon.click();
    });

    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(1);
  });

  it("a single End Early still saves one sit, then opens its completion screen", async () => {
    const save = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(save.promise);
    const view = await mountOnSaveHook();

    await press(view.container, "end early & keep");
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(1);
    expect(view.setOverlay).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve(synced("server-1"));
      await Promise.all(view.saves);
    });
    expect(view.setOverlay.mock.calls).toEqual([["complete"]]);
  });

  it("a single Abandon still saves one sit, then closes it", async () => {
    const save = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(save.promise);
    const view = await mountOnSaveHook();

    await press(view.container, "abandon");
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(1);
    expect(queue.saveCompletedSession.mock.calls[0]![0]).toMatchObject({ completed: false });

    await act(async () => {
      save.resolve(synced("server-1"));
      await Promise.all(view.saves);
    });
    expect(view.setOverlay.mock.calls).toEqual([[null]]);
  });
});
