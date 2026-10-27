/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { User } from "./api";
import { LocalSessionWriteError, SessionSyncError } from "./offlineSessionQueue/sessionSyncCoordinator";
import type { SavedSessionResult } from "./offlineSessionQueue/types";
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

  function Probe({ user }: { user: User | null }) {
    userRef.current = user;
    latest = useSessionSaveLifecycle({
      sessionGeneration,
      loadedSitsRef,
      user,
      userRef,
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
    sessionGeneration,
    loadedSitsRef,
    refreshUserFromServer,
    refreshTodayTracks,
    setOverlay,
    /** A sign-out, then a sign-in as `next`. Each bumps the generation, as the auth hook does. */
    switchAccount: async (next: User) => {
      sessionGeneration.current += 2;
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
