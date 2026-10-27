/**
 * Issue #834 — queue writes take one Web Lock that every tab shares.
 *
 * A "tab" here is its own copy of the coordinator module, so it has its own
 * in-memory chain, over one store, the way every tab of the app shares one
 * IndexedDB. The in-memory chain alone orders a tab's own writes only; the
 * existing coordinator tests cover that order within one tab.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { OFFLINE_OPEN_ROW_LOCK_PREFIX, OFFLINE_QUEUE_LOCK_NAME, UPLOAD_TIMEOUT_MS } from "./constants";
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

/** Let every queued microtask run, so a write that is blocked shows as blocked.
 *  Real timers only: under fake ones, advance the clock instead. */
const drainMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
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

/**
 * #907: `fetch` over a connection that never answers, as the live transport
 * sees it. A call settles only once its signal aborts, and then rejects the way
 * `fetch` does. With no signal, it never settles.
 */
function stubStalledFetch() {
  const signals: Array<RequestInit["signal"]> = [];
  let uploadStarted!: () => void;
  const started = new Promise<void>((resolve) => { uploadStarted = resolve; });
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
    signals.push(init.signal);
    uploadStarted();
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    });
  }));
  return { signals, started };
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

  test("a sign-out clear empties the queue at once, and again after an upload that held the lock", async () => {
    const { request } = fakeLockManager();
    vi.stubGlobal("navigator", { locks: { request } });
    const store = new CopyingQueueStore();
    await store.saveEntries([syncedEntry([{ timeInSession: -1, text: "first draft" }])]);

    // The service worker's flush: it holds the lock across its uploads, then
    // saves back the whole queue it read before them.
    let readDone!: () => void;
    const read = new Promise<void>((resolve) => { readDone = resolve; });
    let releaseUpload!: () => void;
    const released = new Promise<void>((resolve) => { releaseUpload = resolve; });
    const workerFlush = request(OFFLINE_QUEUE_LOCK_NAME, async () => {
      const snapshot = await store.loadEntries();
      readDone();
      await released;
      await store.saveEntries(snapshot);
    });
    await read;

    const tab = await openTab();
    const clearing = new tab.WebSessionSyncCoordinator(store, tab.alwaysFailingSessionSyncTransport).clearQueue();
    await drainMicrotasks();

    // Sign-out does not wait for an upload, which can run to its deadline (#907).
    expect(await store.loadEntries()).toEqual([]);

    releaseUpload();
    await workerFlush;
    await clearing;

    // The flush saved its earlier read back; the clear in turn removed it.
    expect(await store.loadEntries()).toEqual([]);
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

describe("WebSessionSyncCoordinator upload deadline (#907)", () => {
  test("an upload that never settles is aborted at the deadline: the lock is freed and the entry stays queued", async () => {
    const { request } = fakeLockManager();
    vi.stubGlobal("navigator", { locks: { request } });
    const { signals, started } = stubStalledFetch();
    const store = new CopyingQueueStore();
    const queued = syncedEntry([{ timeInSession: -1, text: "first draft" }]);
    await store.saveEntries([queued]);
    const tab = await openTab();
    vi.useFakeTimers();

    // The live transport, so the upload is a real `fetch` call.
    const flushing = new tab.WebSessionSyncCoordinator(store).flushPending(ownerUserId);
    await started;
    // The next writer in line, from any tab.
    let nextWriterRan = false;
    const nextWriter = request(OFFLINE_QUEUE_LOCK_NAME, async () => {
      nextWriterRan = true;
    });

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - 1);
    expect(nextWriterRan).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(nextWriterRan).toBe(true);
    await nextWriter;
    await expect(flushing).resolves.toBe(0);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    // Still queued, thoughts and all, for the next flush.
    expect(await store.loadEntries()).toEqual([queued]);
  });

  test("another tab's queue write goes ahead once the stuck upload is aborted", async () => {
    const { request } = fakeLockManager();
    vi.stubGlobal("navigator", { locks: { request } });
    const { started } = stubStalledFetch();
    const store = new CopyingQueueStore();
    const queued = syncedEntry([{ timeInSession: -1, text: "first draft" }]);
    await store.saveEntries([queued]);
    const uploadingTab = await openTab();
    const savingTab = await openTab();
    vi.useFakeTimers();

    const flushing = new uploadingTab.WebSessionSyncCoordinator(store).flushPending(ownerUserId);
    await started;
    // A sit that ends in the other tab meanwhile. Its own upload fails at once,
    // so the stuck one is all it waits for.
    const nextSitId = "550e8400-e29b-41d4-a716-446655440907";
    const saving = new savingTab.WebSessionSyncCoordinator(store, savingTab.alwaysFailingSessionSyncTransport)
      .saveCompletedSession(sitRequest, nextSitId, ownerUserId, []);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - 1);
    // Still waiting for the lock, so the new sit is not stored yet.
    expect((await store.loadEntries()).map((entry) => entry.clientSessionId)).toEqual([clientSessionId]);

    await vi.advanceTimersByTimeAsync(1);
    expect((await store.loadEntries()).map((entry) => entry.clientSessionId)).toEqual([clientSessionId, nextSitId]);
    await expect(saving).resolves.toMatchObject({ isPendingSync: true, serverSessionId: null });
    await expect(flushing).resolves.toBe(0);
    const [stuck, saved] = await store.loadEntries();
    expect(stuck).toEqual(queued);
    expect(saved).toMatchObject({ clientSessionId: nextSitId, ownerUserId, sessionSynced: false });
  });
});

describe("WebSessionSyncCoordinator return-home prune across tabs (#947)", () => {
  test("keeps a row another tab's completion screen holds open", async () => {
    const { request } = fakeLockManager();
    const query = vi.fn(async () => ({
      held: [{ name: `${OFFLINE_OPEN_ROW_LOCK_PREFIX}${clientSessionId}`, mode: "shared" as const }],
      pending: [],
    }));
    vi.stubGlobal("navigator", { locks: { request, query } });
    const tab = await openTab();
    const store = new CopyingQueueStore();
    await store.saveEntries([syncedEntry([])]);

    await new tab.WebSessionSyncCoordinator(store, tab.alwaysFailingSessionSyncTransport)
      .flushAndPruneCompleted(ownerUserId);

    expect(query).toHaveBeenCalled();
    expect(await store.loadEntries()).toEqual([syncedEntry([])]);
  });

  test("with no screen holding it, the row is dropped", async () => {
    const { request } = fakeLockManager();
    const query = vi.fn(async () => ({ held: [], pending: [] }));
    vi.stubGlobal("navigator", { locks: { request, query } });
    const tab = await openTab();
    const store = new CopyingQueueStore();
    await store.saveEntries([syncedEntry([])]);

    await new tab.WebSessionSyncCoordinator(store, tab.alwaysFailingSessionSyncTransport)
      .flushAndPruneCompleted(ownerUserId);

    expect(await store.loadEntries()).toEqual([]);
  });

  test("when the other tabs' holds cannot be read, nothing is dropped", async () => {
    const { request } = fakeLockManager();
    const query = vi.fn(async () => {
      throw new Error("InvalidStateError");
    });
    vi.stubGlobal("navigator", { locks: { request, query } });
    const tab = await openTab();
    const store = new CopyingQueueStore();
    await store.saveEntries([syncedEntry([])]);

    await new tab.WebSessionSyncCoordinator(store, tab.alwaysFailingSessionSyncTransport)
      .flushAndPruneCompleted(ownerUserId);

    expect(await store.loadEntries()).toEqual([syncedEntry([])]);
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
