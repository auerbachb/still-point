/** @vitest-environment jsdom */
import { act, createElement, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { User } from "./api";
import { LocalSessionWriteError, SessionSyncError } from "./offlineSessionQueue/sessionSyncCoordinator";
import type { SavedSessionResult } from "./offlineSessionQueue/types";
import { tracksDoneOn } from "./practiceDaySits";
import type { PracticeDaySit } from "./sessionCalendar";
import { useSessionSaveLifecycle, type CompletedSitInput } from "./useSessionSaveLifecycle";

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const queue = vi.hoisted(() => ({
  saveCompletedSession: vi.fn(),
}));

// Only the coordinator is faked. The outcome classifier stays real, so these
// tests exercise the same `LocalSessionWriteError` / `SessionSyncError` split
// the app relies on (#703).
vi.mock("@/lib/offlineSessionQueue", () => ({
  getWebSessionSyncCoordinator: () => queue,
}));

const USER: User = {
  id: "user-1",
  email: "sitter@example.com",
  username: "sitter",
  isPublic: false,
  currentDay: 5,
  aphorismsEnabled: false,
};

const USER_B: User = { ...USER, id: "user-b", email: "b@example.com", username: "beta" };

function sit(overrides: Partial<CompletedSitInput> = {}): CompletedSitInput {
  return {
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

function synced(sessionId: string): SavedSessionResult {
  return { sessionId, isPendingSync: false, serverSessionId: sessionId };
}

function queued(clientSessionId: string): SavedSessionResult {
  return { sessionId: clientSessionId, isPendingSync: true, serverSessionId: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The request and client id of the `index`-th coordinator call. */
function saveCall(index: number) {
  const [request, clientSessionId, ownerUserId, thoughts] = queue.saveCompletedSession.mock.calls[index]!;
  return { request, clientSessionId, ownerUserId, thoughts };
}

/* -------------------------------------------------------------------------- */
/* Minimal renderHook (no @testing-library/react in this repo)                 */
/* -------------------------------------------------------------------------- */

const liveViews: Array<{ unmount: () => Promise<void> }> = [];

async function renderLifecycle(initialUser: User | null = USER) {
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

afterEach(async () => {
  for (const view of liveViews.splice(0)) {
    await view.unmount();
  }
  queue.saveCompletedSession.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */

describe("useSessionSaveLifecycle — completed sit (#703)", () => {
  test("a synced sit opens the completion screen and re-reads the user", async () => {
    queue.saveCompletedSession.mockResolvedValueOnce(synced("server-1"));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionComplete(sit());
    });

    const { request, ownerUserId, thoughts } = saveCall(0);
    expect(request).toMatchObject({ dayNumber: 5, sessionType: "standard", track: "primary", completed: true });
    expect(ownerUserId).toBe("user-1");
    expect(thoughts).toEqual([{ timeInSession: 12, text: "rain" }]);
    expect(hook.current().completionData).toMatchObject({
      sessionId: "server-1",
      isPendingSync: false,
      notStored: false,
      // Day 5 done: the preview is day 6's length.
      nextDuration: 110,
    });
    expect(hook.current().localWriteFailed).toBe(false);
    expect(hook.setOverlay).toHaveBeenCalledWith("complete");
    expect(hook.refreshUserFromServer).toHaveBeenCalledTimes(1);
    expect(hook.refreshTodayTracks).toHaveBeenCalledTimes(1);
  });

  test("a queued sit shows as pending, refreshes the badges, and is remembered for the grace window", async () => {
    queue.saveCompletedSession.mockImplementationOnce(async (_request, clientSessionId: string) =>
      queued(clientSessionId),
    );
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionComplete(sit({ track: "second" }));
    });

    const { request, clientSessionId } = saveCall(0);
    expect(hook.current().completionData).toMatchObject({
      sessionId: clientSessionId,
      clientSessionId,
      isPendingSync: true,
      notStored: false,
    });
    expect(hook.refreshUserFromServer).not.toHaveBeenCalled();
    expect(hook.refreshTodayTracks).toHaveBeenCalledTimes(1);
    expect(hook.loadedSitsRef.current).toEqual([
      { completed: true, sessionType: "standard", sessionDate: request.sessionDate, track: "second" },
    ]);
  });

  test("a refused local write is reported as not stored, and raises the strip", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession.mockRejectedValueOnce(new LocalSessionWriteError("queueWriteFailed"));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionComplete(sit());
    });

    expect(hook.current().completionData).toMatchObject({
      sessionId: null,
      isPendingSync: false,
      notStored: true,
    });
    expect(hook.current().localWriteFailed).toBe(true);
    // Nothing was stored, so nothing moved: no refresh, nothing remembered.
    expect(hook.refreshUserFromServer).not.toHaveBeenCalled();
    expect(hook.refreshTodayTracks).not.toHaveBeenCalled();
    expect(hook.loadedSitsRef.current).toBeNull();
    expect(hook.setOverlay).toHaveBeenCalledWith("complete");
  });

  test("a validation guard that rejects before any write is also not stored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession.mockRejectedValueOnce(new SessionSyncError("ownerMismatch"));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionComplete(sit());
    });

    expect(hook.current().completionData?.notStored).toBe(true);
    expect(hook.current().localWriteFailed).toBe(true);
  });

  test("a sync error thrown after the entry was durable stays pending", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession.mockRejectedValueOnce(new Error("permanent transport failure"));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionComplete(sit());
    });

    const { clientSessionId } = saveCall(0);
    expect(hook.current().completionData).toMatchObject({
      sessionId: clientSessionId,
      isPendingSync: true,
      notStored: false,
    });
    expect(hook.current().localWriteFailed).toBe(false);
  });

  test("an abandoned standard sit through onComplete neither refreshes nor is remembered", async () => {
    queue.saveCompletedSession.mockResolvedValueOnce(synced("server-1"));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionComplete(sit({ completed: false }));
    });

    expect(hook.refreshUserFromServer).not.toHaveBeenCalled();
    expect(hook.refreshTodayTracks).not.toHaveBeenCalled();
    expect(hook.loadedSitsRef.current).toBeNull();
    // Not completed: the day does not advance, so the preview stays on day 5.
    expect(hook.current().completionData?.nextDuration).toBe(100);
  });
});

describe("useSessionSaveLifecycle — a combined sit (#892)", () => {
  /** Two-a-day: Track One past the cap (600 s) and Track Two on day 20 (250 s). */
  const DUAL: User = { ...USER, currentDay: 200, dualTrackEnabled: true, secondTrackDay: 20 };

  /** Today's two sits done as one, as `SessionView` reports it. */
  function combinedSit(overrides: Partial<CompletedSitInput> = {}): CompletedSitInput {
    return sit({ dayNumber: 200, track: "primary", combined: true, duration: 850, actualTime: 850, ...overrides });
  }

  test("a completed one queues combined: true and checks off both tracks while it waits to sync", async () => {
    queue.saveCompletedSession.mockImplementationOnce(async (_request, clientSessionId: string) =>
      queued(clientSessionId),
    );
    const hook = await renderLifecycle(DUAL);

    await act(async () => {
      await hook.current().handleSessionComplete(combinedSit());
    });

    const { request } = saveCall(0);
    expect(request).toMatchObject({
      combined: true,
      completed: true,
      sessionType: "standard",
      track: "primary",
      dayNumber: 200,
      duration: 850,
    });
    expect(hook.loadedSitsRef.current).toEqual([
      { completed: true, sessionType: "standard", sessionDate: request.sessionDate, track: "primary", combined: true },
    ]);
    expect(tracksDoneOn(hook.loadedSitsRef.current!, request.sessionDate)).toEqual({ primary: true, second: true });
    expect(hook.refreshTodayTracks).toHaveBeenCalledTimes(1);
    expect(hook.current().completionData).toMatchObject({ isPendingSync: true, notStored: false, track: "primary" });
    // Tomorrow is the next two sits: Track One holds at 600 s, Track Two moves to day 21 (260 s).
    expect(hook.current().completionData?.nextDuration).toBe(860);
  });

  test("a synced one re-reads the user and the badges, as any synced sit does", async () => {
    queue.saveCompletedSession.mockResolvedValueOnce(synced("server-1"));
    const hook = await renderLifecycle(DUAL);

    await act(async () => {
      await hook.current().handleSessionComplete(combinedSit());
    });

    expect(saveCall(0).request).toMatchObject({ combined: true, completed: true });
    expect(hook.refreshUserFromServer).toHaveBeenCalledTimes(1);
    expect(hook.refreshTodayTracks).toHaveBeenCalledTimes(1);
    expect(hook.loadedSitsRef.current).toEqual([
      expect.objectContaining({ track: "primary", combined: true }),
    ]);
  });

  test("ended early, it queues combined: true with completed: false and remembers nothing", async () => {
    queue.saveCompletedSession.mockResolvedValueOnce(synced("server-1"));
    const hook = await renderLifecycle(DUAL);

    await act(async () => {
      await hook.current().handleSessionComplete(combinedSit({ completed: false, actualTime: 300 }));
    });

    expect(saveCall(0).request).toMatchObject({ combined: true, completed: false, track: "primary" });
    expect(hook.loadedSitsRef.current).toBeNull();
    expect(hook.refreshUserFromServer).not.toHaveBeenCalled();
    expect(hook.refreshTodayTracks).not.toHaveBeenCalled();
    // Nothing moved, so tomorrow is today's combined length again.
    expect(hook.current().completionData?.nextDuration).toBe(850);
  });

  test("not stored, it remembers nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession.mockRejectedValueOnce(new LocalSessionWriteError("queueWriteFailed"));
    const hook = await renderLifecycle(DUAL);

    await act(async () => {
      await hook.current().handleSessionComplete(combinedSit());
    });

    expect(saveCall(0).request).toMatchObject({ combined: true });
    expect(hook.current().completionData?.notStored).toBe(true);
    expect(hook.loadedSitsRef.current).toBeNull();
    expect(hook.refreshTodayTracks).not.toHaveBeenCalled();
  });

  test("a retry after a refused write sends the same combined sit again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession
      .mockRejectedValueOnce(new LocalSessionWriteError("queueWriteFailed"))
      .mockResolvedValueOnce(synced("server-1"));
    const hook = await renderLifecycle(DUAL);

    await act(async () => {
      await hook.current().handleSessionComplete(combinedSit());
    });
    await act(async () => {
      await hook.current().handleRetryCompletionSave();
    });

    expect(saveCall(1).request).toMatchObject({ combined: true, completed: true });
    expect(saveCall(1).clientSessionId).toBe(saveCall(0).clientSessionId);
  });

  test("abandoned, it queues combined: true as not completed and closes the sit", async () => {
    queue.saveCompletedSession.mockResolvedValueOnce(synced("server-1"));
    const hook = await renderLifecycle(DUAL);

    await act(async () => {
      await hook.current().handleSessionAbandon(combinedSit());
    });

    expect(saveCall(0).request).toMatchObject({ combined: true, completed: false, track: "primary" });
    expect(hook.loadedSitsRef.current).toBeNull();
    expect(hook.setOverlay).toHaveBeenCalledWith(null);
  });

  test("an ordinary sit's request has no combined key at all", async () => {
    queue.saveCompletedSession.mockResolvedValue(synced("server-1"));
    const hook = await renderLifecycle(DUAL);

    await act(async () => {
      await hook.current().handleSessionComplete(sit());
    });
    await act(async () => {
      await hook.current().handleSessionComplete(sit({ track: "second", combined: false }));
    });
    await act(async () => {
      await hook.current().handleSessionAbandon(sit());
    });

    for (const index of [0, 1, 2]) {
      expect(saveCall(index).request).not.toHaveProperty("combined");
    }
    expect(hook.loadedSitsRef.current?.every((remembered) => !("combined" in remembered))).toBe(true);
  });

  test("before 6:00, the sit after a queued combined sit lands on the new day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 5, 30, 0)); // local Oct 27, 5:30
    queue.saveCompletedSession.mockImplementation(async (_request, clientSessionId: string) =>
      queued(clientSessionId),
    );
    const hook = await renderLifecycle(DUAL);

    await act(async () => {
      await hook.current().handleSessionComplete(combinedSit());
    });
    // No session list yet, so it takes yesterday, which was still open.
    expect(saveCall(0).request.sessionDate).toBe("2026-10-26");

    await act(async () => {
      await hook.current().handleSessionComplete(sit({ dayNumber: 201 }));
    });
    // That one sit closed both of yesterday's tracks, so the next one is today's.
    expect(saveCall(1).request.sessionDate).toBe("2026-10-27");
  });

  test("before 6:00, a combined sit stored only on retry still closes yesterday", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 5, 30, 0)); // local Oct 27, 5:30
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession
      .mockRejectedValueOnce(new LocalSessionWriteError("queueWriteFailed"))
      .mockImplementation(async (_request, clientSessionId: string) => queued(clientSessionId));
    const hook = await renderLifecycle(DUAL);

    await act(async () => {
      await hook.current().handleSessionComplete(combinedSit());
    });
    expect(hook.loadedSitsRef.current).toBeNull();
    // The retry is stored on this device and waits to sync.
    await act(async () => {
      await hook.current().handleRetryCompletionSave();
    });
    expect(hook.loadedSitsRef.current).toEqual([
      { completed: true, sessionType: "standard", sessionDate: "2026-10-26", track: "primary", combined: true },
    ]);

    await act(async () => {
      await hook.current().handleSessionComplete(sit({ dayNumber: 201 }));
    });
    // The retried sit closed both of yesterday's tracks, so the next one is today's.
    expect(saveCall(2).request.sessionDate).toBe("2026-10-27");
  });

  test("control: before 6:00, the sit after a queued plain primary sit still credits yesterday", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 5, 30, 0));
    queue.saveCompletedSession.mockImplementation(async (_request, clientSessionId: string) =>
      queued(clientSessionId),
    );
    const hook = await renderLifecycle(DUAL);

    await act(async () => {
      await hook.current().handleSessionComplete(sit({ dayNumber: 200 }));
    });
    await act(async () => {
      await hook.current().handleSessionComplete(sit({ track: "second", dayNumber: 20 }));
    });

    // Two-a-day: yesterday stays open until Track Two is done too.
    expect(saveCall(0).request.sessionDate).toBe("2026-10-26");
    expect(saveCall(1).request.sessionDate).toBe("2026-10-26");
  });
});

describe("useSessionSaveLifecycle — retry from the completion screen (#703)", () => {
  test("reuses the client id and the day pinned when the sit ended", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 25, 23, 59, 0)); // local Oct 25, 23:59
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession
      .mockRejectedValueOnce(new LocalSessionWriteError("queueWriteFailed"))
      .mockResolvedValueOnce(synced("server-1"));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionComplete(sit());
    });
    expect(hook.current().localWriteFailed).toBe(true);

    // The retry lands the next morning, past midnight and past 6:00.
    vi.setSystemTime(new Date(2026, 9, 26, 6, 30, 0));
    await act(async () => {
      await hook.current().handleRetryCompletionSave();
    });

    const first = saveCall(0);
    const retry = saveCall(1);
    expect(first.request.sessionDate).toBe("2026-10-25");
    expect(retry.request.sessionDate).toBe("2026-10-25");
    expect(retry.clientSessionId).toBe(first.clientSessionId);
    expect(hook.current().completionData).toMatchObject({
      sessionId: "server-1",
      isPendingSync: false,
      notStored: false,
    });
    // A later successful save is the proof storage works again.
    expect(hook.current().localWriteFailed).toBe(false);
  });

  test("a retry that lands as pending is remembered for the grace window", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession
      .mockRejectedValueOnce(new LocalSessionWriteError("queueWriteFailed"))
      .mockImplementationOnce(async (_request, clientSessionId: string) => queued(clientSessionId));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionComplete(sit({ track: "second" }));
    });
    // Not stored, so nothing was remembered then.
    expect(hook.loadedSitsRef.current).toBeNull();

    await act(async () => {
      await hook.current().handleRetryCompletionSave();
    });

    expect(hook.current().completionData).toMatchObject({ isPendingSync: true, notStored: false });
    expect(hook.loadedSitsRef.current).toEqual([
      { completed: true, sessionType: "standard", sessionDate: saveCall(1).request.sessionDate, track: "second" },
    ]);
  });

  test("a retry that settles after a sign-out leaves the next account's sits alone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = deferred<SavedSessionResult>();
    queue.saveCompletedSession
      .mockRejectedValueOnce(new LocalSessionWriteError("queueWriteFailed"))
      .mockReturnValueOnce(retry.promise);
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionComplete(sit());
    });
    let done!: Promise<void>;
    await act(async () => {
      done = hook.current().handleRetryCompletionSave();
    });
    // A sign-out lands while the retry is suspended.
    hook.sessionGeneration.current += 1;
    await act(async () => {
      retry.resolve(queued(saveCall(1).clientSessionId));
      await done;
    });

    expect(hook.loadedSitsRef.current).toBeNull();
  });

  test("rejects while the sit is still not stored, so the banner keeps its retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession.mockRejectedValue(new LocalSessionWriteError("queueWriteFailed"));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionComplete(sit());
    });

    let retryError: unknown;
    await act(async () => {
      await hook.current().handleRetryCompletionSave().catch((error: unknown) => {
        retryError = error;
      });
    });
    expect(retryError).toBeInstanceOf(Error);
    expect(hook.current().completionData?.notStored).toBe(true);
  });

  test("rejects when there is no sit to retry", async () => {
    const hook = await renderLifecycle();
    await expect(hook.current().handleRetryCompletionSave()).rejects.toThrow("Failed to save session");
    expect(queue.saveCompletedSession).not.toHaveBeenCalled();
  });
});

describe("useSessionSaveLifecycle — abandoned and breath sits (#703, #376)", () => {
  test("an abandoned sit that could not be stored raises the strip, then closes the sit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession.mockRejectedValueOnce(new LocalSessionWriteError("queueWriteFailed"));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionAbandon(sit({ completed: true }));
    });

    expect(saveCall(0).request).toMatchObject({ completed: false, track: "primary" });
    expect(hook.current().localWriteFailed).toBe(true);
    expect(hook.current().completionData).toBeNull();
    expect(hook.setOverlay).toHaveBeenCalledWith(null);
  });

  test("an abandoned sit whose sync failed after a durable write keeps the strip's promise", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession.mockRejectedValueOnce(new Error("permanent transport failure"));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionAbandon(sit());
    });

    expect(hook.current().localWriteFailed).toBe(false);
  });

  test("a breath sit is saved as a completed breath session", async () => {
    queue.saveCompletedSession.mockResolvedValueOnce(synced("server-1"));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleBreathEnd({ elapsedSeconds: 42, breathCount: 7, tapCount: 14 });
    });

    expect(saveCall(0).request).toMatchObject({
      dayNumber: 5,
      sessionType: "breath",
      duration: 42,
      actualTime: 42,
      completed: true,
      breathCount: 7,
    });
    expect(saveCall(0).thoughts).toEqual([]);
    expect(hook.setOverlay).toHaveBeenCalledWith(null);
  });

  test("a breath sit with no taps is not logged", async () => {
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleBreathEnd({ elapsedSeconds: 0, breathCount: 0, tapCount: 0 });
    });

    expect(queue.saveCompletedSession).not.toHaveBeenCalled();
    expect(hook.setOverlay).toHaveBeenCalledWith(null);
  });

  test("a breath sit that could not be stored raises the strip", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession.mockRejectedValueOnce(new LocalSessionWriteError("queueWriteFailed"));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleBreathEnd({ elapsedSeconds: 30, breathCount: 5, tapCount: 10 });
    });

    expect(hook.current().localWriteFailed).toBe(true);
    expect(hook.setOverlay).toHaveBeenCalledWith(null);
  });

  test("a second End while the first breath save is running is ignored", async () => {
    const pending = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(pending.promise);
    const hook = await renderLifecycle();

    let first!: Promise<void>;
    await act(async () => {
      first = hook.current().handleBreathEnd({ elapsedSeconds: 30, breathCount: 5, tapCount: 10 });
    });
    await act(async () => {
      await hook.current().handleBreathEnd({ elapsedSeconds: 31, breathCount: 5, tapCount: 11 });
    });
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(synced("server-1"));
      await first;
    });
    expect(hook.setOverlay).toHaveBeenCalledTimes(1);
  });
});

describe("useSessionSaveLifecycle — focus sessions (#836)", () => {
  const FOCUSER: User = { ...USER, focusActivityDay: 4 };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  test("a completed focus session saves as focus on the focus day and steps the goal", async () => {
    // 05:30 with no sits loaded: `creditedPracticeDate` would answer yesterday.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 26, 5, 30, 0));
    queue.saveCompletedSession.mockResolvedValueOnce(synced("server-1"));
    const hook = await renderLifecycle(FOCUSER);

    await act(async () => {
      await hook.current().handleFocusEnd({ duration: 240, actualTime: 240, completed: true }, "writing");
    });

    const { request, clientSessionId, ownerUserId, thoughts } = saveCall(0);
    expect(request).toEqual({
      dayNumber: 4,
      sessionType: "focus",
      // #837: the picker's choice travels with the queued request.
      focusCategory: "writing",
      duration: 240,
      bonusSeconds: 0,
      completed: true,
      actualTime: 240,
      clearPercent: 0,
      thoughtCount: 0,
      mindStateLog: [],
      // The plain calendar date, not the credited practice day.
      sessionDate: "2026-10-26",
    });
    expect(clientSessionId).toMatch(UUID);
    expect(ownerUserId).toBe("user-1");
    expect(thoughts).toEqual([]);
    // One step, the rule the server applies, so Home shows the next goal now.
    expect(hook.user()?.focusActivityDay).toBe(5);
    // Then the server's own counter is re-read, as after a synced standard sit.
    expect(hook.refreshUserFromServer).toHaveBeenCalledTimes(1);
    // A focus session moves no meditation state and has no completion screen.
    expect(hook.refreshTodayTracks).not.toHaveBeenCalled();
    expect(hook.loadedSitsRef.current).toBeNull();
    expect(hook.current().completionData).toBeNull();
    expect(hook.setOverlay).toHaveBeenCalledTimes(1);
    expect(hook.setOverlay).toHaveBeenCalledWith(null);
  });

  test("a session with no category saves null, and every category steps the one goal (#837)", async () => {
    queue.saveCompletedSession.mockResolvedValue(synced("server-1"));
    const hook = await renderLifecycle(FOCUSER);

    await act(async () => {
      await hook.current().handleFocusEnd({ duration: 240, actualTime: 240, completed: true });
    });
    expect(saveCall(0).request).toMatchObject({ sessionType: "focus", focusCategory: null });
    expect(hook.user()?.focusActivityDay).toBe(5);

    await act(async () => {
      await hook.current().handleFocusEnd({ duration: 300, actualTime: 300, completed: true }, "listening");
    });
    expect(saveCall(1).request).toMatchObject({ dayNumber: 5, focusCategory: "listening" });
    expect(hook.user()?.focusActivityDay).toBe(6);
  });

  test("each session gets its own client id", async () => {
    queue.saveCompletedSession.mockResolvedValue(synced("server-1"));
    const hook = await renderLifecycle(FOCUSER);

    await act(async () => {
      await hook.current().handleFocusEnd({ duration: 240, actualTime: 30, completed: false });
    });
    await act(async () => {
      await hook.current().handleFocusEnd({ duration: 240, actualTime: 40, completed: false });
    });

    expect(saveCall(0).clientSessionId).not.toBe(saveCall(1).clientSessionId);
  });

  test("a session queued offline still steps the goal, once", async () => {
    queue.saveCompletedSession.mockImplementationOnce(async (_request, clientSessionId: string) =>
      queued(clientSessionId),
    );
    const hook = await renderLifecycle(FOCUSER);

    await act(async () => {
      await hook.current().handleFocusEnd({ duration: 240, actualTime: 240, completed: true });
    });

    expect(saveCall(0).request).toMatchObject({ sessionType: "focus", completed: true });
    expect(hook.user()?.focusActivityDay).toBe(5);
    expect(hook.setUser).toHaveBeenCalledTimes(1);
    // Not on the server yet: the `onSynced` refresh after its upload re-reads.
    expect(hook.refreshUserFromServer).not.toHaveBeenCalled();
    expect(hook.current().localWriteFailed).toBe(false);
    expect(hook.setOverlay).toHaveBeenCalledWith(null);
  });

  test("a synced save adopts the server's counter when another client stepped it too", async () => {
    queue.saveCompletedSession.mockResolvedValueOnce(synced("server-1"));
    const hook = await renderLifecycle(FOCUSER);
    // Another client also finished a session from day 4, so the server is at 6.
    hook.refreshUserFromServer.mockImplementation(() => {
      hook.setUser((prev) => (prev ? { ...prev, focusActivityDay: 6 } : prev));
    });

    await act(async () => {
      await hook.current().handleFocusEnd({ duration: 240, actualTime: 240, completed: true });
    });

    expect(hook.refreshUserFromServer).toHaveBeenCalledTimes(1);
    expect(hook.user()?.focusActivityDay).toBe(6);
  });

  test("ending early saves the time spent and leaves the goal where it was", async () => {
    queue.saveCompletedSession.mockResolvedValueOnce(synced("server-1"));
    const hook = await renderLifecycle(FOCUSER);

    await act(async () => {
      await hook.current().handleFocusEnd({ duration: 240, actualTime: 20, completed: false });
    });

    expect(saveCall(0).request).toMatchObject({
      dayNumber: 4,
      sessionType: "focus",
      duration: 240,
      actualTime: 20,
      completed: false,
    });
    expect(hook.setUser).not.toHaveBeenCalled();
    expect(hook.refreshUserFromServer).not.toHaveBeenCalled();
    expect(hook.user()?.focusActivityDay).toBe(4);
    expect(hook.setOverlay).toHaveBeenCalledWith(null);
  });

  test("End before a whole second saves nothing and just closes", async () => {
    const hook = await renderLifecycle(FOCUSER);

    await act(async () => {
      await hook.current().handleFocusEnd(null);
    });

    expect(queue.saveCompletedSession).not.toHaveBeenCalled();
    expect(hook.setUser).not.toHaveBeenCalled();
    expect(hook.setOverlay).toHaveBeenCalledWith(null);
  });

  test("a session that could not be stored raises the strip and does not step the goal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession.mockRejectedValueOnce(new LocalSessionWriteError("queueWriteFailed"));
    const hook = await renderLifecycle(FOCUSER);

    await act(async () => {
      await hook.current().handleFocusEnd({ duration: 240, actualTime: 240, completed: true });
    });

    expect(hook.current().localWriteFailed).toBe(true);
    expect(hook.setUser).not.toHaveBeenCalled();
    expect(hook.refreshUserFromServer).not.toHaveBeenCalled();
    expect(hook.user()?.focusActivityDay).toBe(4);
    expect(hook.setOverlay).toHaveBeenCalledWith(null);
  });

  test("a user from a server without the counter starts at day 1", async () => {
    queue.saveCompletedSession.mockResolvedValueOnce(synced("server-1"));
    const hook = await renderLifecycle(USER);

    await act(async () => {
      await hook.current().handleFocusEnd({ duration: 60, actualTime: 60, completed: true });
    });

    expect(saveCall(0).request).toMatchObject({ dayNumber: 1, duration: 60 });
    expect(hook.user()?.focusActivityDay).toBe(2);
  });

  test("a server re-read that already applied the step is not stepped again", async () => {
    const pending = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(pending.promise);
    const hook = await renderLifecycle(FOCUSER);

    let done!: Promise<void>;
    await act(async () => {
      done = hook.current().handleFocusEnd({ duration: 240, actualTime: 240, completed: true });
    });
    // A re-read (an `onSynced` refresh, say) lands with the server's day 5 first.
    await act(async () => {
      hook.setUser((prev) => (prev ? { ...prev, focusActivityDay: 5 } : prev));
    });
    await act(async () => {
      pending.resolve(synced("server-1"));
      await done;
    });

    expect(hook.user()?.focusActivityDay).toBe(5);
  });

  test("a second End while the first focus save is running is ignored", async () => {
    const pending = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(pending.promise);
    const hook = await renderLifecycle(FOCUSER);

    let first!: Promise<void>;
    await act(async () => {
      first = hook.current().handleFocusEnd({ duration: 240, actualTime: 240, completed: true });
    });
    await act(async () => {
      await hook.current().handleFocusEnd({ duration: 240, actualTime: 240, completed: true });
    });
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(synced("server-1"));
      await first;
    });
    expect(hook.user()?.focusActivityDay).toBe(5);
    expect(hook.setOverlay).toHaveBeenCalledTimes(1);
  });

  test("a save that settles after an account switch neither steps nor closes the next account's", async () => {
    const pending = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(pending.promise);
    const hook = await renderLifecycle(FOCUSER);

    let done!: Promise<void>;
    await act(async () => {
      done = hook.current().handleFocusEnd({ duration: 240, actualTime: 240, completed: true });
    });
    await hook.switchAccount({ ...USER_B, focusActivityDay: 9 });
    await act(async () => {
      pending.resolve(synced("server-1"));
      await done;
    });

    expect(hook.setUser).not.toHaveBeenCalled();
    expect(hook.refreshUserFromServer).not.toHaveBeenCalled();
    expect(hook.user()?.focusActivityDay).toBe(9);
    expect(hook.setOverlay).not.toHaveBeenCalled();
  });
});

describe("useSessionSaveLifecycle — sign-out mid-save (#666)", () => {
  test("a completed sit that settles after a sign-out reopens nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(pending.promise);
    const hook = await renderLifecycle();

    let done!: Promise<void>;
    await act(async () => {
      done = hook.current().handleSessionComplete(sit());
    });
    // A sign-out lands while the save is suspended.
    hook.sessionGeneration.current += 1;
    await act(async () => {
      pending.reject(new LocalSessionWriteError("queueWriteFailed"));
      await done;
    });

    expect(hook.current().localWriteFailed).toBe(false);
    expect(hook.current().completionData).toBeNull();
    expect(hook.setOverlay).not.toHaveBeenCalled();
    expect(hook.loadedSitsRef.current).toBeNull();
  });

  test("the previous account's failed abandon does not raise the strip for the next one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(pending.promise);
    const hook = await renderLifecycle();

    let done!: Promise<void>;
    await act(async () => {
      done = hook.current().handleSessionAbandon(sit());
    });
    hook.sessionGeneration.current += 1;
    await act(async () => {
      pending.reject(new LocalSessionWriteError("queueWriteFailed"));
      await done;
    });

    expect(hook.current().localWriteFailed).toBe(false);
  });
});

describe("useSessionSaveLifecycle — a save that outlives its account (#833)", () => {
  test("an abandoned sit that settles after an account switch leaves the next account's sit open", async () => {
    const pending = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(pending.promise);
    const hook = await renderLifecycle();

    let done!: Promise<void>;
    await act(async () => {
      done = hook.current().handleSessionAbandon(sit());
    });
    await hook.switchAccount(USER_B);
    await act(async () => {
      pending.resolve(synced("server-1"));
      await done;
    });

    expect(hook.setOverlay).not.toHaveBeenCalled();
  });

  test("a breath sit that settles after an account switch leaves the next account's sit open", async () => {
    const pending = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(pending.promise);
    const hook = await renderLifecycle();

    let done!: Promise<void>;
    await act(async () => {
      done = hook.current().handleBreathEnd({ elapsedSeconds: 30, breathCount: 5, tapCount: 10 });
    });
    await hook.switchAccount(USER_B);
    await act(async () => {
      pending.resolve(synced("server-1"));
      await done;
    });

    expect(hook.setOverlay).not.toHaveBeenCalled();
  });

  test("the previous account's pending breath save neither swallows nor ends the next account's", async () => {
    const saveA = deferred<SavedSessionResult>();
    const saveB = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(saveA.promise).mockReturnValueOnce(saveB.promise);
    const hook = await renderLifecycle();

    let endA!: Promise<void>;
    await act(async () => {
      endA = hook.current().handleBreathEnd({ elapsedSeconds: 30, breathCount: 5, tapCount: 10 });
    });
    await hook.switchAccount(USER_B);

    // The next account's End is not swallowed: it saves its own sit.
    let endB!: Promise<void>;
    await act(async () => {
      endB = hook.current().handleBreathEnd({ elapsedSeconds: 20, breathCount: 4, tapCount: 8 });
    });
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(2);
    expect(saveCall(1).ownerUserId).toBe("user-b");

    // The previous save settling closes nothing and leaves the new gate held,
    // so a second End from the next account is still a duplicate.
    await act(async () => {
      saveA.resolve(synced("server-a"));
      await endA;
    });
    expect(hook.setOverlay).not.toHaveBeenCalled();
    await act(async () => {
      await hook.current().handleBreathEnd({ elapsedSeconds: 21, breathCount: 4, tapCount: 9 });
    });
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(2);

    await act(async () => {
      saveB.resolve(synced("server-b"));
      await endB;
    });
    expect(hook.setOverlay).toHaveBeenCalledTimes(1);
    expect(hook.setOverlay).toHaveBeenCalledWith(null);
  });
});

describe("useSessionSaveLifecycle — account teardown", () => {
  test("clearLocalWriteFailed drops the previous account's not-stored warning", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.saveCompletedSession.mockRejectedValueOnce(new LocalSessionWriteError("queueWriteFailed"));
    const hook = await renderLifecycle();

    await act(async () => {
      await hook.current().handleSessionAbandon(sit());
    });
    expect(hook.current().localWriteFailed).toBe(true);

    await act(async () => {
      hook.current().clearLocalWriteFailed();
    });
    expect(hook.current().localWriteFailed).toBe(false);
  });

  test("with no user, a finished sit still shows its completion screen but saves nothing", async () => {
    const hook = await renderLifecycle(null);

    await act(async () => {
      await hook.current().handleSessionComplete(sit());
    });

    expect(queue.saveCompletedSession).not.toHaveBeenCalled();
    expect(hook.current().completionData).toMatchObject({
      sessionId: null,
      isPendingSync: false,
      notStored: false,
      nextDuration: 60,
    });
    expect(hook.setOverlay).toHaveBeenCalledWith("complete");
  });
});
