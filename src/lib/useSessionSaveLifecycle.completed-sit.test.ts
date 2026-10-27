/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LocalSessionWriteError, SessionSyncError } from "./offlineSessionQueue/sessionSyncCoordinator";
import type { SavedSessionResult } from "./offlineSessionQueue/types";
import {
  deferred,
  queued,
  renderLifecycle,
  saveCall,
  sit,
  synced,
  resetSessionSaveLifecycleHarness,
} from "./testing/sessionSaveLifecycleHarness";
import { queue } from "./testing/sessionSaveLifecycleQueue";

// The fake coordinator, shared with the harness (#1006): see `sessionSaveLifecycleQueue.ts`.
vi.mock("@/lib/offlineSessionQueue", async () => {
  const { queue } = await import("./testing/sessionSaveLifecycleQueue");
  return { getWebSessionSyncCoordinator: () => queue };
});

afterEach(resetSessionSaveLifecycleHarness);

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
