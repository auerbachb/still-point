import { act, createElement, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type { User } from "@/lib/api";
import type { SavedSessionResult } from "@/lib/offlineSessionQueue/types";
import type { PracticeDaySit } from "@/lib/sessionCalendar";
import { useSessionSaveLifecycle, type CompletedSitInput } from "@/lib/useSessionSaveLifecycle";
import { queue } from "./sessionSaveLifecycleQueue";

/**
 * Shared harness for the `useSessionSaveLifecycle.*.test.ts` files (#1006).
 *
 * The suite is split by concern so a change to one save path touches one file.
 * Every file still needs, at its top:
 *
 * - `/** @vitest-environment jsdom *\/`
 * - the `vi.mock("@/lib/offlineSessionQueue", …)` call shown in
 *   `sessionSaveLifecycleQueue.ts` (a `vi.mock` only hoists in the test file)
 * - `afterEach(resetSessionSaveLifecycleHarness)`
 *
 * A file that drives the fake queue imports `queue` straight from
 * `sessionSaveLifecycleQueue.ts`, not through this module: a re-export of it
 * from here reads as `undefined` once the mock factory has run mid-import.
 */

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const USER: User = {
  id: "user-1",
  email: "sitter@example.com",
  username: "sitter",
  isPublic: false,
  currentDay: 5,
  aphorismsEnabled: false,
};

export const USER_B: User = { ...USER, id: "user-b", email: "b@example.com", username: "beta" };

let sitsMade = 0;

export function sit(overrides: Partial<CompletedSitInput> = {}): CompletedSitInput {
  sitsMade += 1;
  return {
    // #930: every call is a sit of its own, as each `SessionView` mount is.
    sitKey: `sit-${sitsMade}`,
    dayNumber: 5,
    sessionType: "standard",
    track: "primary",
    duration: 100,
    bonusSeconds: 0,
    completed: true,
    actualTime: 100,
    clearPercent: 80,
    thoughtCount: 1,
    mindStateLog: [{ time: 0, state: "clear" }],
    thoughts: [{ timeInSession: 12, text: "rain" }],
    ...overrides,
  };
}

export function synced(sessionId: string): SavedSessionResult {
  return { sessionId, isPendingSync: false, serverSessionId: sessionId };
}

export function queued(clientSessionId: string): SavedSessionResult {
  return { sessionId: clientSessionId, isPendingSync: true, serverSessionId: null };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The request and client id of the `index`-th coordinator call. */
export function saveCall(index: number) {
  const [request, clientSessionId, ownerUserId, thoughts] = queue.saveCompletedSession.mock.calls[index]!;
  return { request, clientSessionId, ownerUserId, thoughts };
}

/* -------------------------------------------------------------------------- */
/* Minimal renderHook (no @testing-library/react in this repo)                 */
/* -------------------------------------------------------------------------- */

const liveViews: Array<{ unmount: () => Promise<void> }> = [];

export async function renderLifecycle(initialUser: User | null = USER) {
  const sessionGeneration = { current: 0 };
  const loadedSitsRef: { current: PracticeDaySit[] | null } = { current: null };
  const userRef = { current: initialUser };
  const refreshUserFromServer = vi.fn();
  const refreshTodayTracks = vi.fn(async () => {});
  const setOverlay = vi.fn();

  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  let latest!: ReturnType<typeof useSessionSaveLifecycle>;
  // The page's user state: `setUser` applies an update and re-renders with it,
  // as the auth hook's state setter would.
  let currentUser = initialUser;
  const setUser = vi.fn((update: SetStateAction<User | null>) => {
    currentUser = typeof update === "function" ? update(currentUser) : update;
    root?.render(createElement(Probe, { user: currentUser }));
  });

  function Probe({ user }: { user: User | null }) {
    userRef.current = user;
    latest = useSessionSaveLifecycle({
      sessionGeneration,
      loadedSitsRef,
      user,
      userRef,
      setUser,
      refreshUserFromServer,
      refreshTodayTracks,
      setOverlay,
    });
    return null;
  }

  const view = {
    unmount: async () => {
      await act(async () => {
        root?.unmount();
      });
      root = null;
      container.remove();
    },
  };
  liveViews.push(view);
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(Probe, { user: initialUser }));
  });

  return {
    current: () => latest,
    /** The user as the page holds it now, after any `setUser`. */
    user: () => currentUser,
    sessionGeneration,
    loadedSitsRef,
    setUser,
    refreshUserFromServer,
    refreshTodayTracks,
    setOverlay,
    /** A sign-out, then a sign-in as `next`. Each bumps the generation, as the auth hook does. */
    switchAccount: async (next: User) => {
      sessionGeneration.current += 2;
      currentUser = next;
      await act(async () => {
        root?.render(createElement(Probe, { user: next }));
      });
    },
  };
}

/** Unmounts every rendered hook and resets the fake queue, timers and spies. */
export async function resetSessionSaveLifecycleHarness() {
  for (const view of liveViews.splice(0)) {
    await view.unmount();
  }
  queue.saveCompletedSession.mockReset();
  queue.resolvedServerSessionId.mockReset();
  queue.resolvedServerSessionId.mockResolvedValue(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
}
