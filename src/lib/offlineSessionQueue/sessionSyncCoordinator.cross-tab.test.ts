/**
 * Issue #834 — queue writes take one Web Lock that every tab shares.
 *
 * A "tab" here is its own copy of the coordinator module, so it has its own
 * in-memory chain, over one store, the way every tab of the app shares one
 * IndexedDB. The in-memory chain alone orders a tab's own writes only; the
 * existing coordinator tests cover that order within one tab.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { OFFLINE_QUEUE_LOCK_NAME } from "./constants";
import type { OfflineSessionQueueStore } from "./queueStore";
import type { SessionSyncTransport } from "./transport";
import type { PendingSessionEntry } from "./types";

type CoordinatorModule = typeof import("./sessionSyncCoordinator");
type SentBatch = Parameters<SessionSyncTransport["batchThoughts"]>[0];

const ownerUserId = "user-test-834";
const clientSessionId = "550e8400-e29b-41d4-a716-446655440834";

const sitRequest = {
  dayNumber: 1,
  sessionType: "standard" as const,
  duration: 60,
  completed: true,
  actualTime: 60,
  clearPercent: 100,
  thoughtCount: 0,
  mindStateLog: [] as Array<{ time: number; state: string }>,
  sessionDate: "2026-10-26",
};

/** Let every queued microtask run, so a write that is blocked shows as blocked. */
const drainMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fresh copy of the coordinator module: what another tab loads. */
async function openTab(): Promise<CoordinatorModule> {
  vi.resetModules();
  return import("./sessionSyncCoordinator");
}

/** Hands out copies, as IndexedDB does: a read is a snapshot, and only a write
 *  changes what is stored. */
class CopyingQueueStore implements OfflineSessionQueueStore {
  private entries: PendingSessionEntry[] = [];

  async loadEntries(): Promise<PendingSessionEntry[]> {
    return structuredClone(this.entries);
  }

  async saveEntries(entries: PendingSessionEntry[]): Promise<void> {
    this.entries = structuredClone(entries);
  }
}

/**
 * Web Locks as the coordinator relies on it, shared by every tab: one holder
 * per name, granted in request order, and released however the callback
 * settles.
 */
function fakeLockManager() {
  const turns = new Map<string, Promise<unknown>>();
  const request = vi.fn((name: string, callback: LockGrantedCallback<unknown>) => {
    const lock: Lock = { name, mode: "exclusive" };
    const granted = (turns.get(name) ?? Promise.resolve()).then(() => callback(lock));
    turns.set(
      name,
      granted.then(
        () => undefined,
        () => undefined,
      ),
    );
    return granted;
  });
  return { request };
}

/** A synced sit with these thoughts still queued, as a flush would find it. */
function syncedEntry(thoughts: PendingSessionEntry["thoughts"]): PendingSessionEntry {
  return {
    clientSessionId,
    ownerUserId,
    request: { ...sitRequest, clientSessionId },
    thoughts,
    serverSessionId: `server-${clientSessionId}`,
    sessionSynced: true,
    enqueuedAt: "2026-10-26T12:00:00.000Z",
  };
}

describe("WebSessionSyncCoordinator cross-tab lock (#834)", () => {
  test("a note clear in one tab waits for another tab's upload of that note, then deletes it", async () => {
    const { request } = fakeLockManager();
    vi.stubGlobal("navigator", { locks: { request } });
    const store = new CopyingQueueStore();
    await store.saveEntries([syncedEntry([{ timeInSession: -1, text: "first draft" }])]);

    // Everything either tab sends, in the order it goes out.
    const batches: SentBatch[] = [];
    let uploadStarted!: () => void;
    const started = new Promise<void>((resolve) => { uploadStarted = resolve; });
    let releaseUpload!: () => void;
    const released = new Promise<void>((resolve) => { releaseUpload = resolve; });

    const flushingTab = await openTab();
    const clearingTab = await openTab();
    const flushing = new flushingTab.WebSessionSyncCoordinator(store, {
      ...flushingTab.alwaysFailingSessionSyncTransport,
      batchThoughts: async (data) => {
        batches.push(data);
        uploadStarted();
        await released;
      },
    }).flushPending(ownerUserId);
    await started;
    const clearing = new clearingTab.WebSessionSyncCoordinator(store, {
      ...clearingTab.alwaysFailingSessionSyncTransport,
      batchThoughts: async (data) => {
        batches.push(data);
      },
    }).clearEndNote(clientSessionId, ownerUserId);
    await drainMicrotasks();

    // The clear waits for the lock: nothing new on the wire, and the queue
    // still holds the note the other tab is sending.
    expect(batches).toHaveLength(1);
    expect((await store.loadEntries())[0]!.thoughts).toEqual([{ timeInSession: -1, text: "first draft" }]);

    releaseUpload();
    await flushing;
    await clearing;

    // The upload, then the clear that deletes what it stored.
    expect(batches.map((batch) => [batch.thoughts, batch.clearCompletionNote])).toEqual([
      [[{ timeInSession: -1, text: "first draft" }], undefined],
      [[], true],
    ]);
    const [entry] = await store.loadEntries();
    expect(entry!.thoughts).toEqual([]);
    expect(entry!.clearCompletionNote).toBe(false);
  });

  test("every queue write takes the shared lock, and reads do not", async () => {
    const { request } = fakeLockManager();
    vi.stubGlobal("navigator", { locks: { request } });
    const tab = await openTab();
    const coordinator = new tab.WebSessionSyncCoordinator(
      new CopyingQueueStore(),
      tab.alwaysFailingSessionSyncTransport,
    );

    await coordinator.saveCompletedSession(sitRequest, clientSessionId, ownerUserId, []);
    await coordinator.replaceEndNote(clientSessionId, ownerUserId, "a note");
    await coordinator.clearEndNote(clientSessionId, ownerUserId);
    await coordinator.flushPending(ownerUserId);
    await coordinator.pruneCompletedEntries(ownerUserId);
    await coordinator.pendingCount(ownerUserId);
    await coordinator.resolvedServerSessionId(clientSessionId, ownerUserId);
    await coordinator.clearQueue();

    // Save, note set, note clear, the flush of the one queued sit, prune, clear.
    expect(request.mock.calls.map(([name]) => name)).toEqual(Array(6).fill(OFFLINE_QUEUE_LOCK_NAME));
  });

  test("an error inside the lock reaches the caller unchanged, runs once, and frees the lock", async () => {
    const { request } = fakeLockManager();
    vi.stubGlobal("navigator", { locks: { request } });
    const tab = await openTab();
    const writeFailure = new Error("QuotaExceededError");
    let writes = 0;
    const refusingStore: OfflineSessionQueueStore = {
      loadEntries: async () => [],
      saveEntries: async () => {
        writes += 1;
        throw writeFailure;
      },
    };

    const error = await new tab.WebSessionSyncCoordinator(refusingStore, tab.alwaysFailingSessionSyncTransport)
      .saveCompletedSession(sitRequest, clientSessionId, ownerUserId, [])
      .catch((caught: unknown) => caught);

    // #703: still tagged, so the caller says the sit is not stored.
    expect(error).toBeInstanceOf(tab.LocalSessionWriteError);
    expect((error as Error).cause).toBe(writeFailure);
    expect(writes).toBe(1);

    const store = new CopyingQueueStore();
    await new tab.WebSessionSyncCoordinator(store, tab.alwaysFailingSessionSyncTransport)
      .saveCompletedSession(sitRequest, clientSessionId, ownerUserId, []);
    expect(await store.loadEntries()).toHaveLength(1);
  });

  test("a lock request refused before it is granted still makes the write, once", async () => {
    const request = vi.fn(async () => {
      throw new DOMException("The lock request was refused", "SecurityError");
    });
    vi.stubGlobal("navigator", { locks: { request } });
    const tab = await openTab();
    const store = new CopyingQueueStore();
    let uploadAttempts = 0;

    const result = await new tab.WebSessionSyncCoordinator(store, {
      ...tab.alwaysFailingSessionSyncTransport,
      createSession: async () => {
        uploadAttempts += 1;
        throw new TypeError("Network unavailable");
      },
    }).saveCompletedSession(sitRequest, clientSessionId, ownerUserId, []);

    // Stored and pending: a bare rejection here would read as a queued sit
    // with nothing written (#703).
    expect(result.isPendingSync).toBe(true);
    expect(await store.loadEntries()).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(uploadAttempts).toBe(1);
  });
});

describe.each([
  ["no navigator", undefined],
  ["a navigator without Web Locks", {}],
])("WebSessionSyncCoordinator without Web Locks: %s (#834)", (_label, navigatorStub) => {
  test("one tab's writes still take turns: a clear waits for the note upload ahead of it", async () => {
    vi.stubGlobal("navigator", navigatorStub);
    const tab = await openTab();
    const store = new CopyingQueueStore();
    await store.saveEntries([syncedEntry([{ timeInSession: -1, text: "first draft" }])]);

    const batches: SentBatch[] = [];
    let uploadStarted!: () => void;
    const started = new Promise<void>((resolve) => { uploadStarted = resolve; });
    let releaseUpload!: () => void;
    const released = new Promise<void>((resolve) => { releaseUpload = resolve; });
    const coordinator = new tab.WebSessionSyncCoordinator(store, {
      ...tab.alwaysFailingSessionSyncTransport,
      batchThoughts: async (data) => {
        batches.push(data);
        if (batches.length === 1) {
          uploadStarted();
          await released;
        }
      },
    });

    const flushing = coordinator.flushPending(ownerUserId);
    await started;
    const clearing = coordinator.clearEndNote(clientSessionId, ownerUserId);
    await drainMicrotasks();
    expect(batches).toHaveLength(1);

    releaseUpload();
    await flushing;
    await clearing;
    expect(batches.map((batch) => batch.clearCompletionNote)).toEqual([undefined, true]);
  });

  test("a failed write frees the turn for the next one", async () => {
    vi.stubGlobal("navigator", navigatorStub);
    const tab = await openTab();
    const refusingStore: OfflineSessionQueueStore = {
      loadEntries: async () => [],
      saveEntries: async () => {
        throw new Error("QuotaExceededError");
      },
    };

    await expect(
      new tab.WebSessionSyncCoordinator(refusingStore, tab.alwaysFailingSessionSyncTransport)
        .saveCompletedSession(sitRequest, clientSessionId, ownerUserId, []),
    ).rejects.toBeInstanceOf(tab.LocalSessionWriteError);

    const store = new CopyingQueueStore();
    await new tab.WebSessionSyncCoordinator(store, tab.alwaysFailingSessionSyncTransport)
      .saveCompletedSession(sitRequest, clientSessionId, ownerUserId, []);
    expect(await store.loadEntries()).toHaveLength(1);
  });
});
