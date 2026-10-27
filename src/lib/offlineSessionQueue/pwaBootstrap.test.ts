/** @vitest-environment jsdom */
/**
 * Issue #978 — when the service worker's sync sent a sit's session row and then
 * parked the sit, the tab's own flush skips it and counts nothing. The worker's
 * flush message says a session synced, so the tab still refreshes progression.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const flushPending = vi.fn<(ownerUserId: string) => Promise<number>>();

vi.mock("./sessionSyncCoordinator", () => ({
  getWebSessionSyncCoordinator: () => ({ flushPending }),
}));

const { initWebPwaOffline } = await import("./pwaBootstrap");

type MessageListener = (event: MessageEvent) => void;

let messageListeners: MessageListener[] = [];
let teardown: () => void = () => {};

function postFromWorker(data: unknown) {
  for (const listener of messageListeners) listener({ data } as MessageEvent);
}

/** Lets the `flushPending` chains the bootstrap started settle. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  messageListeners = [];
  flushPending.mockReset();
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: vi.fn(async () => ({})),
      addEventListener: (type: string, listener: MessageListener) => {
        if (type === "message") messageListeners.push(listener);
      },
      removeEventListener: (type: string, listener: MessageListener) => {
        if (type === "message") messageListeners = messageListeners.filter((item) => item !== listener);
      },
    },
  });
});

afterEach(() => {
  teardown();
  teardown = () => {};
});

describe("initWebPwaOffline onSynced (#978)", () => {
  test("refreshes when the worker sent a session row the tab's flush then skips", async () => {
    flushPending.mockResolvedValue(0);
    const onSynced = vi.fn();
    teardown = initWebPwaOffline(() => "user-978", onSynced);
    await settle();
    expect(onSynced).not.toHaveBeenCalled();

    postFromWorker({ type: "flush-offline-session-queue", sessionSynced: true });
    await settle();

    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  test("refreshes even when the tab's own flush then fails", async () => {
    flushPending.mockResolvedValueOnce(0).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const onSynced = vi.fn();
    teardown = initWebPwaOffline(() => "user-978", onSynced);
    await settle();

    postFromWorker({ type: "flush-offline-session-queue", sessionSynced: true });
    await settle();

    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  test("refreshes for the worker's sit without waiting for a slow tab flush", async () => {
    let finishFlush: (count: number) => void = () => {};
    flushPending
      .mockResolvedValueOnce(0)
      .mockImplementationOnce(() => new Promise<number>((resolve) => { finishFlush = resolve; }));
    const onSynced = vi.fn();
    teardown = initWebPwaOffline(() => "user-978", onSynced);
    await settle();

    postFromWorker({ type: "flush-offline-session-queue", sessionSynced: true });
    await settle();
    expect(onSynced).toHaveBeenCalledTimes(1);

    // A flush that synced nothing of its own does not refresh a second time.
    finishFlush(0);
    await settle();
    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  test("does not refresh when neither the worker nor the tab synced anything", async () => {
    flushPending.mockResolvedValue(0);
    const onSynced = vi.fn();
    teardown = initWebPwaOffline(() => "user-978", onSynced);
    await settle();

    postFromWorker({ type: "flush-offline-session-queue", sessionSynced: false });
    postFromWorker({ type: "flush-offline-session-queue" });
    await settle();

    expect(onSynced).not.toHaveBeenCalled();
  });

  test("refreshes when the tab's own flush synced a sit", async () => {
    flushPending.mockResolvedValue(1);
    const onSynced = vi.fn();
    teardown = initWebPwaOffline(() => "user-978", onSynced);
    await settle();

    expect(onSynced).toHaveBeenCalledTimes(1);
  });
});
