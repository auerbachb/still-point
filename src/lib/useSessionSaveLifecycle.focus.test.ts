/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { User } from "./api";
import { LocalSessionWriteError } from "./offlineSessionQueue/sessionSyncCoordinator";
import type { SavedSessionResult } from "./offlineSessionQueue/types";
import {
  deferred,
  queued,
  renderLifecycle,
  saveCall,
  sit,
  synced,
  USER,
  USER_B,
  resetSessionSaveLifecycleHarness,
} from "./testing/sessionSaveLifecycleHarness";
import { queue } from "./testing/sessionSaveLifecycleQueue";

// The fake coordinator, shared with the harness (#1006): see `sessionSaveLifecycleQueue.ts`.
vi.mock("@/lib/offlineSessionQueue", async () => {
  const { queue } = await import("./testing/sessionSaveLifecycleQueue");
  return { getWebSessionSyncCoordinator: () => queue };
});

afterEach(resetSessionSaveLifecycleHarness);

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
