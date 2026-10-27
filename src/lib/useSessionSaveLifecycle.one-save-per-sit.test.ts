/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SavedSessionResult } from "./offlineSessionQueue/types";
import { tracksDoneOn } from "./practiceDaySits";
import {
  deferred,
  renderLifecycle,
  saveCall,
  sit,
  synced,
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

describe("useSessionSaveLifecycle — one save per sit (#930)", () => {
  // `SessionView` sends every terminal call of a sit with the same `sitKey`. A
  // second call used to mint a second client id, which the queue and
  // `POST /api/sessions` keep as a second sit.

  test("a second End Early while the sit's save runs saves nothing and changes no screen", async () => {
    const pending = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(pending.promise);
    const hook = await renderLifecycle();
    const ended = sit({ completed: false });

    let first!: Promise<void>;
    await act(async () => {
      first = hook.current().handleSessionComplete(ended);
    });
    await act(async () => {
      await hook.current().handleSessionComplete({ ...ended, actualTime: 101 });
    });
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(1);
    expect(hook.setOverlay).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve(synced("server-1"));
      await first;
    });
    expect(hook.setOverlay.mock.calls).toEqual([["complete"]]);
    expect(hook.current().completionData?.clientSessionId).toBe(saveCall(0).clientSessionId);
  });

  test("Abandon after End Early on the same sit is refused", async () => {
    const pending = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(pending.promise);
    const hook = await renderLifecycle();
    const ended = sit({ completed: false });

    let first!: Promise<void>;
    await act(async () => {
      first = hook.current().handleSessionComplete(ended);
    });
    await act(async () => {
      await hook.current().handleSessionAbandon(ended);
    });
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(synced("server-1"));
      await first;
    });
    // The completion screen opens, and nothing closes it again.
    expect(hook.setOverlay.mock.calls).toEqual([["complete"]]);
  });

  test("a second Abandon, or End Early after Abandon, on the same sit is refused", async () => {
    const pending = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(pending.promise);
    const hook = await renderLifecycle();
    const left = sit({ completed: false });

    let first!: Promise<void>;
    await act(async () => {
      first = hook.current().handleSessionAbandon(left);
    });
    await act(async () => {
      await hook.current().handleSessionAbandon(left);
    });
    await act(async () => {
      await hook.current().handleSessionComplete(left);
    });
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(synced("server-1"));
      await first;
    });
    expect(hook.setOverlay.mock.calls).toEqual([[null]]);
    expect(hook.current().completionData).toBeNull();
  });

  test("a sit begun while an earlier sit's save still runs saves too", async () => {
    // Browser Back closes a sit while its upload may still be waiting, and the
    // person can begin another before it settles.
    const earlier = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(earlier.promise).mockResolvedValueOnce(synced("server-2"));
    const hook = await renderLifecycle();

    let first!: Promise<void>;
    await act(async () => {
      first = hook.current().handleSessionComplete(sit({ completed: false }));
    });
    await act(async () => {
      await hook.current().handleSessionComplete(sit());
    });

    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(2);
    expect(saveCall(1).clientSessionId).not.toBe(saveCall(0).clientSessionId);

    await act(async () => {
      earlier.resolve(synced("server-1"));
      await first;
    });
  });

  test("an earlier account's save still running does not swallow the next account's sit", async () => {
    const saveA = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(saveA.promise).mockResolvedValueOnce(synced("server-b"));
    const hook = await renderLifecycle();

    let endA!: Promise<void>;
    await act(async () => {
      endA = hook.current().handleSessionAbandon(sit());
    });
    await hook.switchAccount(USER_B);
    await act(async () => {
      await hook.current().handleSessionAbandon(sit());
    });
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(2);
    expect(saveCall(1).ownerUserId).toBe("user-b");
    expect(hook.setOverlay.mock.calls).toEqual([[null]]);

    // The previous account's save settling closes nothing of the next one's.
    await act(async () => {
      saveA.resolve(synced("server-a"));
      await endA;
    });
    expect(hook.setOverlay.mock.calls).toEqual([[null]]);
  });

  // `SessionView` never sends a sit twice; this pins that the hook keeps
  // nothing of a sit once its save is over.
  test("holds a sit only while its save runs: let go when it settles, and when it throws", async () => {
    queue.saveCompletedSession.mockResolvedValue(synced("server-1"));
    const hook = await renderLifecycle();

    const settled = sit();
    await act(async () => {
      await hook.current().handleSessionComplete(settled);
    });
    await act(async () => {
      await hook.current().handleSessionComplete(settled);
    });
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(2);

    const thrown = sit();
    hook.refreshUserFromServer.mockImplementationOnce(() => {
      throw new Error("refresh failed");
    });
    await act(async () => {
      await expect(hook.current().handleSessionComplete(thrown)).rejects.toThrow("refresh failed");
    });
    await act(async () => {
      await hook.current().handleSessionComplete(thrown);
    });
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(4);
  });
});

describe("useSessionSaveLifecycle — a save that settles after Back (#988)", () => {
  // Browser Back changes the tab, and the tab effect closes the sit while its
  // save may still be waiting on the upload. The person can then begin another
  // sit. When the first save settles it must leave that sit's screen alone.

  test("End Early, Back, a new sit: the first save opens no completion screen, and the new sit keeps its screen and saves", async () => {
    const earlier = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(earlier.promise).mockResolvedValueOnce(synced("server-2"));
    const hook = await renderLifecycle();
    const ended = sit({ dayNumber: 5 });

    let first!: Promise<void>;
    await act(async () => {
      first = hook.current().handleSessionComplete(ended);
    });
    // Back: the sit's `SessionView` unmounts while its save runs.
    await act(async () => {
      hook.current().handleSitScreenClosed(ended.sitKey);
    });

    // The first save settles while the new sit is on screen.
    await act(async () => {
      earlier.resolve(synced("server-1"));
      await first;
    });
    expect(hook.setOverlay).not.toHaveBeenCalled();
    expect(hook.current().completionData).toBeNull();
    // Still saved, and remembered as today.
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(1);
    expect(hook.refreshUserFromServer).toHaveBeenCalledTimes(1);
    expect(tracksDoneOn(hook.loadedSitsRef.current!, saveCall(0).request.sessionDate).primary).toBe(true);

    // The new sit ends and reaches its own completion screen.
    await act(async () => {
      await hook.current().handleSessionComplete(sit({ dayNumber: 6 }));
    });
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(2);
    expect(hook.setOverlay.mock.calls).toEqual([["complete"]]);
    expect(hook.current().completionData).toMatchObject({
      sessionId: "server-2",
      dayNumber: 6,
      clientSessionId: saveCall(1).clientSessionId,
    });
  });

  test("Abandon, Back, a new sit: the first save closes nothing, and the new sit keeps its screen and saves", async () => {
    const earlier = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(earlier.promise).mockResolvedValueOnce(synced("server-2"));
    const hook = await renderLifecycle();
    const left = sit({ completed: false });

    let first!: Promise<void>;
    await act(async () => {
      first = hook.current().handleSessionAbandon(left);
    });
    await act(async () => {
      hook.current().handleSitScreenClosed(left.sitKey);
    });

    await act(async () => {
      earlier.resolve(synced("server-1"));
      await first;
    });
    expect(hook.setOverlay).not.toHaveBeenCalled();
    // The abandoned sit is still saved.
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(1);
    expect(saveCall(0).request).toMatchObject({ completed: false });

    await act(async () => {
      await hook.current().handleSessionComplete(sit());
    });
    expect(queue.saveCompletedSession).toHaveBeenCalledTimes(2);
    expect(hook.setOverlay.mock.calls).toEqual([["complete"]]);
    expect(hook.current().completionData?.clientSessionId).toBe(saveCall(1).clientSessionId);
  });

  test("a sit begun mid-save and abandoned closes its own screen, untouched by the earlier save", async () => {
    const earlier = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(earlier.promise).mockResolvedValueOnce(synced("server-2"));
    const hook = await renderLifecycle();
    const ended = sit({ completed: false });

    let first!: Promise<void>;
    await act(async () => {
      first = hook.current().handleSessionComplete(ended);
    });
    await act(async () => {
      hook.current().handleSitScreenClosed(ended.sitKey);
    });
    await act(async () => {
      await hook.current().handleSessionAbandon(sit());
    });
    expect(hook.setOverlay.mock.calls).toEqual([[null]]);

    await act(async () => {
      earlier.resolve(synced("server-1"));
      await first;
    });
    expect(hook.setOverlay.mock.calls).toEqual([[null]]);
    expect(hook.current().completionData).toBeNull();
  });

  test("a screen that closes after its save settled leaves nothing behind for that sit", async () => {
    // The completion screen opening unmounts the sit's `SessionView` too, so
    // its close report comes after the save. It must not linger.
    queue.saveCompletedSession.mockResolvedValue(synced("server-1"));
    const hook = await renderLifecycle();
    const done = sit();

    await act(async () => {
      await hook.current().handleSessionComplete(done);
    });
    await act(async () => {
      hook.current().handleSitScreenClosed(done.sitKey);
    });
    expect(hook.setOverlay.mock.calls).toEqual([["complete"]]);

    // Were the close kept, a later save under the same key would be silenced.
    await act(async () => {
      await hook.current().handleSessionComplete(done);
    });
    expect(hook.setOverlay.mock.calls).toEqual([["complete"], ["complete"]]);
  });

  test("a sit whose screen is still open when its save settles reaches the completion screen, or closes after Abandon", async () => {
    const ending = deferred<SavedSessionResult>();
    const leaving = deferred<SavedSessionResult>();
    queue.saveCompletedSession.mockReturnValueOnce(ending.promise).mockReturnValueOnce(leaving.promise);
    const hook = await renderLifecycle();

    let completed!: Promise<void>;
    await act(async () => {
      completed = hook.current().handleSessionComplete(sit({ completed: false }));
    });
    await act(async () => {
      ending.resolve(synced("server-1"));
      await completed;
    });
    expect(hook.setOverlay.mock.calls).toEqual([["complete"]]);

    let abandoned!: Promise<void>;
    await act(async () => {
      abandoned = hook.current().handleSessionAbandon(sit({ completed: false }));
    });
    await act(async () => {
      leaving.resolve(synced("server-2"));
      await abandoned;
    });
    expect(hook.setOverlay.mock.calls).toEqual([["complete"], [null]]);
  });
});
