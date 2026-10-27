/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { User } from "./api";
import { LocalSessionWriteError } from "./offlineSessionQueue/sessionSyncCoordinator";
import { tracksDoneOn } from "./practiceDaySits";
import type { CompletedSitInput } from "./useSessionSaveLifecycle";
import {
  queued,
  renderLifecycle,
  saveCall,
  sit,
  synced,
  USER,
  resetSessionSaveLifecycleHarness,
} from "./testing/sessionSaveLifecycleHarness";
import { queue } from "./testing/sessionSaveLifecycleQueue";

// The fake coordinator, shared with the harness (#1006): see `sessionSaveLifecycleQueue.ts`.
vi.mock("@/lib/offlineSessionQueue", async () => {
  const { queue } = await import("./testing/sessionSaveLifecycleQueue");
  return { getWebSessionSyncCoordinator: () => queue };
});

afterEach(resetSessionSaveLifecycleHarness);

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
