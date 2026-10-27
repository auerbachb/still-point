/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LocalSessionWriteError } from "./offlineSessionQueue/sessionSyncCoordinator";
import type { SavedSessionResult } from "./offlineSessionQueue/types";
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
