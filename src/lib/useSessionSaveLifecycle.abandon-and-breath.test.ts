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
  resetSessionSaveLifecycleHarness,
} from "./testing/sessionSaveLifecycleHarness";
import { queue } from "./testing/sessionSaveLifecycleQueue";

// The fake coordinator, shared with the harness (#1006): see `sessionSaveLifecycleQueue.ts`.
vi.mock("@/lib/offlineSessionQueue", async () => {
  const { queue } = await import("./testing/sessionSaveLifecycleQueue");
  return { getWebSessionSyncCoordinator: () => queue };
});

afterEach(resetSessionSaveLifecycleHarness);

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
