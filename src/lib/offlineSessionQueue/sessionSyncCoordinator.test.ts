import { afterEach, describe, expect, test, vi } from "vitest";
import { PARKED_MESSAGE_MAX_LENGTH, UPLOAD_TIMEOUT_MS } from "./constants";
import { InMemoryOfflineSessionQueueStore, type OfflineSessionQueueStore } from "./queueStore";
import {
  LocalSessionWriteError,
  SessionSyncError,
  WebSessionSyncCoordinator,
  alwaysFailingSessionSyncTransport,
  provisionalSessionId,
  requestWithClientId,
} from "./sessionSyncCoordinator";
import { liveSessionSyncTransport, type SessionSyncTransport } from "./transport";
import type { PendingSessionEntry, PendingSessionThought } from "./types";

const testOwnerUserId = "user-test-558";

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    dayNumber: 1,
    sessionType: "standard" as const,
    duration: 60,
    completed: true,
    actualTime: 60,
    clearPercent: 100,
    thoughtCount: 0,
    mindStateLog: [] as Array<{ time: number; state: string }>,
    sessionDate: "2026-07-17",
    ...overrides,
  };
}

describe("WebSessionSyncCoordinator (#558)", () => {
  test("saveCompletedSession enqueues when sync unavailable", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const coordinator = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440000";

    const result = await coordinator.saveCompletedSession(
      baseRequest(),
      clientSessionId,
      testOwnerUserId,
      [],
    );

    expect(result.isPendingSync).toBe(true);
    expect(result.sessionId).toBe(clientSessionId);
    const entries = await store.loadEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.ownerUserId).toBe(testOwnerUserId);
    expect(entries[0]!.sessionSynced).toBe(false);
    expect(entries[0]!.request.clientSessionId).toBe(clientSessionId);
  });

  test("duplicate clientSessionId does not duplicate queue entries", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const coordinator = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440001";

    await coordinator.saveCompletedSession(baseRequest(), clientSessionId, testOwnerUserId, []);
    await coordinator.saveCompletedSession(baseRequest(), clientSessionId, testOwnerUserId, []);

    expect(await store.loadEntries()).toHaveLength(1);
  });

  test("flushPending skips entries owned by another user", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const coordinator = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440002";

    await coordinator.saveCompletedSession(baseRequest(), clientSessionId, "user-a", []);

    const flushed = await coordinator.flushPending("user-b");
    expect(flushed).toBe(0);
    expect(await store.loadEntries()).toHaveLength(1);
  });

  test("provisionalSessionId uses clientSessionId", () => {
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440003";
    expect(provisionalSessionId(clientSessionId)).toBe(clientSessionId);
    expect(requestWithClientId(baseRequest({ sessionType: "quick" }), clientSessionId).clientSessionId)
      .toBe(clientSessionId);
  });

  test("flushPending syncs queued session and thoughts with #557 idempotency key", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440004";
    const createCalls: string[] = [];
    const thoughtCalls: string[] = [];

    const transport: SessionSyncTransport = {
      createSession: async (payload) => {
        createCalls.push(payload.clientSessionId);
        return {
          id: "server-session-1",
          dayNumber: payload.dayNumber,
          duration: payload.duration,
          sessionType: payload.sessionType,
          completed: payload.completed,
          actualTime: payload.actualTime,
          clearPercent: payload.clearPercent,
          thoughtCount: payload.thoughtCount,
          mindStateLog: payload.mindStateLog,
          sessionDate: payload.sessionDate,
          createdAt: "2026-07-17T12:00:00.000Z",
        };
      },
      batchThoughts: async (data) => {
        thoughtCalls.push(data.sessionId);
      },
    };

    await new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport).saveCompletedSession(
      baseRequest(),
      clientSessionId,
      testOwnerUserId,
      [{ timeInSession: 10, text: "hello" }],
    );

    const flushed = await new WebSessionSyncCoordinator(store, transport).flushPending(testOwnerUserId);
    expect(flushed).toBe(1);
    expect(createCalls).toEqual([clientSessionId]);
    expect(thoughtCalls).toEqual(["server-session-1"]);

    const entries = await store.loadEntries();
    expect(entries[0]!.sessionSynced).toBe(true);
    expect(entries[0]!.thoughts).toHaveLength(0);
  });

  test("replaceEndNote queues note for pending entry", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const coordinator = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440005";

    await coordinator.saveCompletedSession(baseRequest(), clientSessionId, testOwnerUserId, []);
    await coordinator.replaceEndNote(clientSessionId, testOwnerUserId, "offline note");

    const entries = await store.loadEntries();
    expect(entries[0]!.thoughts).toEqual([{ timeInSession: -1, text: "offline note" }]);
  });

  test("replaceEndNote replaces the queued end note instead of appending another", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const coordinator = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440015";

    await coordinator.saveCompletedSession(
      baseRequest(),
      clientSessionId,
      testOwnerUserId,
      [{ timeInSession: 12, text: "mid-sit" }],
    );
    await coordinator.replaceEndNote(clientSessionId, testOwnerUserId, "first draft");
    await coordinator.replaceEndNote(clientSessionId, testOwnerUserId, "revised note");

    const entries = await store.loadEntries();
    expect(entries[0]!.thoughts).toEqual([
      { timeInSession: 12, text: "mid-sit", clientThoughtId: expect.any(String) },
      { timeInSession: -1, text: "revised note" },
    ]);
  });

  test("a flush keeps an end note replaced while its batch was in flight", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440016";
    await new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport).saveCompletedSession(
      baseRequest(),
      clientSessionId,
      testOwnerUserId,
      [],
    );
    const seeded = await store.loadEntries();
    seeded[0]!.sessionSynced = true;
    seeded[0]!.serverSessionId = "server-session-16";
    seeded[0]!.thoughts = [{ timeInSession: -1, text: "first draft" }];
    await store.saveEntries(seeded);

    const transport: SessionSyncTransport = {
      ...alwaysFailingSessionSyncTransport,
      batchThoughts: async () => {
        const entries = await store.loadEntries();
        entries[0]!.thoughts = [{ timeInSession: -1, text: "revised note" }];
        await store.saveEntries(entries);
      },
    };

    await new WebSessionSyncCoordinator(store, transport).flushPending(testOwnerUserId);

    const entries = await store.loadEntries();
    expect(entries[0]!.thoughts).toEqual([{ timeInSession: -1, text: "revised note" }]);
  });

  test("#703: a refused IndexedDB write throws LocalSessionWriteError, not a pending result", async () => {
    const writeFailure = new Error("QuotaExceededError");
    const refusingStore: OfflineSessionQueueStore = {
      loadEntries: async (): Promise<PendingSessionEntry[]> => [],
      saveEntries: async () => {
        throw writeFailure;
      },
    };
    const coordinator = new WebSessionSyncCoordinator(refusingStore, alwaysFailingSessionSyncTransport);

    await expect(
      coordinator.saveCompletedSession(
        baseRequest(),
        "550e8400-e29b-41d4-a716-446655440007",
        testOwnerUserId,
        [],
      ),
    ).rejects.toThrow(LocalSessionWriteError);
  });

  test("#703: the refused write keeps the underlying storage error as its cause", async () => {
    const writeFailure = new Error("QuotaExceededError");
    const refusingStore: OfflineSessionQueueStore = {
      loadEntries: async (): Promise<PendingSessionEntry[]> => [],
      saveEntries: async () => {
        throw writeFailure;
      },
    };
    const coordinator = new WebSessionSyncCoordinator(refusingStore, alwaysFailingSessionSyncTransport);

    const error = await coordinator
      .saveCompletedSession(baseRequest(), "550e8400-e29b-41d4-a716-446655440008", testOwnerUserId, [])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LocalSessionWriteError);
    expect((error as LocalSessionWriteError).cause).toBe(writeFailure);
  });

  test("#703: an unreadable store throws LocalSessionWriteError too — nothing was stored", async () => {
    const readFailure = new Error("InvalidStateError");
    const unreadableStore: OfflineSessionQueueStore = {
      loadEntries: async (): Promise<PendingSessionEntry[]> => {
        throw readFailure;
      },
      saveEntries: async () => {},
    };
    const coordinator = new WebSessionSyncCoordinator(unreadableStore, alwaysFailingSessionSyncTransport);

    const error = await coordinator
      .saveCompletedSession(baseRequest(), "550e8400-e29b-41d4-a716-446655440009", testOwnerUserId, [])
      .catch((caught: unknown) => caught);

    // Untagged, this would reach `resolveSessionSaveOutcome` as a post-write
    // sync failure and be reported to the user as safely queued.
    expect(error).toBeInstanceOf(LocalSessionWriteError);
    expect((error as LocalSessionWriteError).cause).toBe(readFailure);
  });

  /**
   * The inverse of #703: the write landed and only the upload was refused with a
   * non-retryable status, which `flushEntry` rethrows. The entry must still be in
   * the queue (since #978 parked, unless the status was a 401 or 403, which
   * `flushPending` retries on reconnect), and the error must NOT be a
   * `LocalSessionWriteError` — that tag is what makes the caller say "nowhere".
   */
  test("#703: a permanent sync failure leaves the entry queued and is not tagged as a write failure", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const permanentTransport = {
      createSession: async () => {
        throw Object.assign(new Error("Create session failed (400)"), { permanent: true });
      },
      batchThoughts: async () => {},
    };
    const coordinator = new WebSessionSyncCoordinator(store, permanentTransport);

    const error = await coordinator
      .saveCompletedSession(baseRequest(), "550e8400-e29b-41d4-a716-446655440010", testOwnerUserId, [])
      .catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(LocalSessionWriteError);
    expect(await store.loadEntries()).toHaveLength(1);
  });

  test("replaceEndNote rejects owner mismatch", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const coordinator = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440006";

    await coordinator.saveCompletedSession(baseRequest(), clientSessionId, testOwnerUserId, []);

    await expect(
      coordinator.replaceEndNote(clientSessionId, "other-user", "note"),
    ).rejects.toThrow(SessionSyncError);
  });
});

/** Flushes through the live transport and returns each body it POSTed to `/api/sessions`. */
async function flushThroughLiveTransport(
  store: InMemoryOfflineSessionQueueStore,
): Promise<{ flushed: number; bodies: Array<Record<string, unknown>> }> {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return new Response(JSON.stringify({ session: { id: `server-${String(body.clientSessionId)}` } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }));
  try {
    const flushed = await new WebSessionSyncCoordinator(store, liveSessionSyncTransport())
      .flushPending(testOwnerUserId);
    return { flushed, bodies };
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("WebSessionSyncCoordinator combined sits (#892)", () => {
  test("an entry queued without combined (an older build) still syncs and sends no combined key", async () => {
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440030";
    // Written before #892: its request has no `combined` field at all.
    const legacy: PendingSessionEntry = {
      clientSessionId,
      ownerUserId: testOwnerUserId,
      request: requestWithClientId(baseRequest({ track: "primary" }), clientSessionId),
      thoughts: [],
      serverSessionId: null,
      sessionSynced: false,
      enqueuedAt: "2026-07-17T12:00:00.000Z",
    };
    const store = new InMemoryOfflineSessionQueueStore();
    await store.saveEntries([legacy]);

    const { flushed, bodies } = await flushThroughLiveTransport(store);

    expect(flushed).toBe(1);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ clientSessionId, sessionType: "standard", track: "primary", completed: true });
    expect(bodies[0]).not.toHaveProperty("combined");
    expect((await store.loadEntries())[0]).toMatchObject({
      sessionSynced: true,
      serverSessionId: `server-${clientSessionId}`,
    });
  });

  test("a queued combined sit uploads with combined: true", async () => {
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440031";
    const store = new InMemoryOfflineSessionQueueStore();
    await new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport).saveCompletedSession(
      baseRequest({ track: "primary", combined: true, duration: 850, actualTime: 850 }),
      clientSessionId,
      testOwnerUserId,
      [],
    );

    const { flushed, bodies } = await flushThroughLiveTransport(store);

    expect(flushed).toBe(1);
    expect(bodies).toEqual([expect.objectContaining({ clientSessionId, combined: true, track: "primary", duration: 850 })]);
  });
});

/** Let every queued microtask run, so a chain that is blocked shows as blocked. */
const drainMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

type SentBatch = Parameters<SessionSyncTransport["batchThoughts"]>[0];

/** A synced sit with these thoughts still queued, as a flush would find it. */
async function seedSyncedEntry(
  store: InMemoryOfflineSessionQueueStore,
  clientSessionId: string,
  thoughts: PendingSessionEntry["thoughts"],
): Promise<void> {
  await new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport).saveCompletedSession(
    baseRequest(),
    clientSessionId,
    testOwnerUserId,
    [],
  );
  const seeded = await store.loadEntries();
  seeded[0]!.sessionSynced = true;
  seeded[0]!.serverSessionId = `server-${clientSessionId}`;
  seeded[0]!.thoughts = thoughts;
  await store.saveEntries(seeded);
}

function recordingTransport(batches: SentBatch[]): SessionSyncTransport {
  return {
    ...alwaysFailingSessionSyncTransport,
    batchThoughts: async (data) => {
      batches.push(data);
    },
  };
}

describe("WebSessionSyncCoordinator end-note clear (#792)", () => {
  test("clearEndNote before sync drops the queued note, keeps in-sit thoughts, and sends nothing", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const coordinator = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440020";

    await coordinator.saveCompletedSession(
      baseRequest(),
      clientSessionId,
      testOwnerUserId,
      [{ timeInSession: 12, text: "mid-sit" }],
    );
    await coordinator.replaceEndNote(clientSessionId, testOwnerUserId, "offline note");
    await coordinator.clearEndNote(clientSessionId, testOwnerUserId);

    const [entry] = await store.loadEntries();
    expect(entry!.thoughts).toEqual([{ timeInSession: 12, text: "mid-sit", clientThoughtId: expect.any(String) }]);
    // No server row yet, so there is no stored note to delete.
    expect(entry!.clearCompletionNote).toBe(false);
  });

  test("clearEndNote after sync sends clearCompletionNote to the server session, then resets it", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440021";
    await seedSyncedEntry(store, clientSessionId, []);
    const batches: SentBatch[] = [];

    await new WebSessionSyncCoordinator(store, recordingTransport(batches))
      .clearEndNote(clientSessionId, testOwnerUserId);

    expect(batches).toEqual([{
      sessionId: `server-${clientSessionId}`,
      dayNumber: 1,
      thoughts: [],
      clearCompletionNote: true,
    }]);
    const [entry] = await store.loadEntries();
    expect(entry!.clearCompletionNote).toBe(false);
    expect(entry!.thoughts).toEqual([]);
  });

  test("a clear that cannot reach the server stays queued, counts as pending, and survives pruning", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const coordinator = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440022";
    await seedSyncedEntry(store, clientSessionId, [{ timeInSession: -1, text: "saved note" }]);

    await coordinator.clearEndNote(clientSessionId, testOwnerUserId);
    await coordinator.pruneCompletedEntries(testOwnerUserId);

    const entries = await store.loadEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.thoughts).toEqual([]);
    expect(entries[0]!.clearCompletionNote).toBe(true);
    expect(await coordinator.pendingCount(testOwnerUserId)).toBe(1);

    const batches: SentBatch[] = [];
    const flushed = await new WebSessionSyncCoordinator(store, recordingTransport(batches))
      .flushPending(testOwnerUserId);
    expect(flushed).toBe(1);
    expect(batches.map((batch) => batch.clearCompletionNote)).toEqual([true]);
    expect(await coordinator.pendingCount(testOwnerUserId)).toBe(0);
  });

  test("replaceEndNote after a queued clear sends the new note without the clear flag", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440023";
    await seedSyncedEntry(store, clientSessionId, []);
    const offline = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);
    await offline.clearEndNote(clientSessionId, testOwnerUserId);
    await offline.replaceEndNote(clientSessionId, testOwnerUserId, "second thoughts");

    const batches: SentBatch[] = [];
    await new WebSessionSyncCoordinator(store, recordingTransport(batches)).flushPending(testOwnerUserId);

    // The server replaces the stored note on its own; the flag is not needed.
    expect(batches).toEqual([{
      sessionId: `server-${clientSessionId}`,
      dayNumber: 1,
      thoughts: [{ timeInSession: -1, text: "second thoughts" }],
    }]);
  });

  test("a clear asked for while a note upload is in flight is not erased by that upload's acknowledgement", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440024";
    await seedSyncedEntry(store, clientSessionId, [{ timeInSession: -1, text: "first draft" }]);

    // Another tab clears the note while this tab's upload of it is on the wire.
    const transport: SessionSyncTransport = {
      ...alwaysFailingSessionSyncTransport,
      batchThoughts: async () => {
        const entries = await store.loadEntries();
        entries[0]!.thoughts = [];
        entries[0]!.clearCompletionNote = true;
        await store.saveEntries(entries);
      },
    };

    await new WebSessionSyncCoordinator(store, transport).flushPending(testOwnerUserId);

    const [entry] = await store.loadEntries();
    expect(entry!.clearCompletionNote).toBe(true);
  });

  test("flushPending holds a clear until the note upload ahead of it is acknowledged", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440025";
    await seedSyncedEntry(store, clientSessionId, [{ timeInSession: -1, text: "first draft" }]);

    const batches: SentBatch[] = [];
    let uploadStarted!: () => void;
    const started = new Promise<void>((resolve) => { uploadStarted = resolve; });
    let releaseUpload!: () => void;
    const released = new Promise<void>((resolve) => { releaseUpload = resolve; });
    const coordinator = new WebSessionSyncCoordinator(store, {
      ...alwaysFailingSessionSyncTransport,
      batchThoughts: async (data) => {
        batches.push(data);
        if (batches.length === 1) {
          uploadStarted();
          await released;
        }
      },
    });

    const flushing = coordinator.flushPending(testOwnerUserId);
    await started;
    const clearing = coordinator.clearEndNote(clientSessionId, testOwnerUserId);
    await drainMicrotasks();

    // The clear waits its turn: nothing new on the wire, and the queue still
    // holds the note the in-flight upload is sending.
    expect(batches).toHaveLength(1);
    expect((await store.loadEntries())[0]!.thoughts).toEqual([{ timeInSession: -1, text: "first draft" }]);

    releaseUpload();
    await flushing;
    await clearing;

    // Upload first, then the clear that deletes what it stored.
    expect(batches.map((batch) => [batch.thoughts, batch.clearCompletionNote])).toEqual([
      [[{ timeInSession: -1, text: "first draft" }], undefined],
      [[], true],
    ]);
    const [entry] = await store.loadEntries();
    expect(entry!.thoughts).toEqual([]);
    expect(entry!.clearCompletionNote).toBe(false);
  });

  test("pruning takes its turn, so a clear flagged during it is never silently dropped", async () => {
    const inner = new InMemoryOfflineSessionQueueStore();
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440028";
    // Fully synced and nothing queued: prunable when pruning reads the queue.
    await seedSyncedEntry(inner, clientSessionId, []);

    // A read that returns its snapshot late, like an IndexedDB read whose
    // result lands after other work has run.
    let holdNextRead = false;
    let readTaken!: () => void;
    const taken = new Promise<void>((resolve) => { readTaken = resolve; });
    let releaseRead!: () => void;
    const released = new Promise<void>((resolve) => { releaseRead = resolve; });
    const store: OfflineSessionQueueStore = {
      loadEntries: async () => {
        const snapshot = await inner.loadEntries();
        if (holdNextRead) {
          holdNextRead = false;
          readTaken();
          await released;
        }
        return snapshot;
      },
      saveEntries: (entries) => inner.saveEntries(entries),
    };
    const coordinator = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);

    holdNextRead = true;
    const pruning = coordinator.pruneCompletedEntries(testOwnerUserId);
    await taken;
    const clearing = coordinator.clearEndNote(clientSessionId, testOwnerUserId);
    const clearOutcome = clearing.then(() => "cleared", (error: Error) => error.message);
    await drainMicrotasks();
    releaseRead();
    await pruning;

    // The prune ran first on its own read, so the clear must find no entry and
    // say so — never report success for a flag the prune then threw away.
    expect(await clearOutcome).toBe("entryNotFound");
    expect(await inner.loadEntries()).toEqual([]);
  });

  test("an entry saved before the clear flag existed reads as having nothing to clear", async () => {
    const legacy: PendingSessionEntry = {
      clientSessionId: "550e8400-e29b-41d4-a716-446655440026",
      ownerUserId: testOwnerUserId,
      request: requestWithClientId(baseRequest(), "550e8400-e29b-41d4-a716-446655440026"),
      thoughts: [],
      serverSessionId: "server-legacy",
      sessionSynced: true,
      enqueuedAt: "2026-07-17T12:00:00.000Z",
    };
    const store = new InMemoryOfflineSessionQueueStore();
    await store.saveEntries([legacy]);
    const batches: SentBatch[] = [];
    const coordinator = new WebSessionSyncCoordinator(store, recordingTransport(batches));

    expect(await coordinator.pendingCount(testOwnerUserId)).toBe(0);
    expect(await coordinator.flushPending(testOwnerUserId)).toBe(0);
    expect(batches).toEqual([]);
  });

  test("clearEndNote on an unknown sit throws entryNotFound", async () => {
    const coordinator = new WebSessionSyncCoordinator(
      new InMemoryOfflineSessionQueueStore(),
      alwaysFailingSessionSyncTransport,
    );

    await expect(
      coordinator.clearEndNote("550e8400-e29b-41d4-a716-446655440027", testOwnerUserId),
    ).rejects.toThrow("entryNotFound");
  });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Settles only once `signal` aborts, rejecting the way `fetch` does then. */
function rejectOnAbort(signal: RequestInit["signal"]): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  });
}

type BatchBody = { sessionId: string; thoughts: PendingSessionThought[] };

/**
 * A stand-in for the API behind `liveSessionSyncTransport`. Like the real
 * route (#948), it stores a thought once per id and every thought without one,
 * and it stores a batch before it answers, so a batch whose answer never
 * arrives is stored all the same. `stallBatches` such answers are withheld
 * until the request aborts.
 */
function stubServer({ stallBatches = 0 } = {}) {
  const stored: PendingSessionThought[] = [];
  const batches: BatchBody[] = [];
  let stalled!: () => void;
  const batchStalled = new Promise<void>((resolve) => { stalled = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/api/sessions") {
      return { ok: true, status: 201, json: async () => ({ session: { id: "server-948" } }) };
    }
    const body = JSON.parse(String(init.body)) as BatchBody;
    batches.push(body);
    for (const thought of body.thoughts) {
      if (!thought.clientThoughtId || !stored.some((t) => t.clientThoughtId === thought.clientThoughtId)) {
        stored.push(thought);
      }
    }
    if (stallBatches > 0) {
      stallBatches -= 1;
      stalled();
      return rejectOnAbort(init.signal);
    }
    return { ok: true, status: 200, json: async () => ({ thoughts: [] }) };
  }));
  return { stored, batches, batchStalled };
}

describe("WebSessionSyncCoordinator thought ids (#948)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("each in-session thought is queued with its own id before the first upload, and the end note gets none", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440040";
    const captured = [
      { timeInSession: 12, text: "rain" },
      { timeInSession: 12, text: "rain" },
      { timeInSession: 30, text: "car door" },
    ];
    let queuedAtFirstUpload: PendingSessionThought[] | null = null;
    const offline: SessionSyncTransport = {
      ...alwaysFailingSessionSyncTransport,
      createSession: async () => {
        queuedAtFirstUpload ??= (await store.loadEntries())[0]!.thoughts;
        throw new TypeError("Network unavailable");
      },
    };
    const coordinator = new WebSessionSyncCoordinator(store, offline);

    await coordinator.saveCompletedSession(baseRequest(), clientSessionId, testOwnerUserId, captured);
    await coordinator.replaceEndNote(clientSessionId, testOwnerUserId, "offline note");

    const [entry] = await store.loadEntries();
    expect(entry!.thoughts).toEqual([
      { timeInSession: 12, text: "rain", clientThoughtId: expect.stringMatching(UUID) },
      { timeInSession: 12, text: "rain", clientThoughtId: expect.stringMatching(UUID) },
      { timeInSession: 30, text: "car door", clientThoughtId: expect.stringMatching(UUID) },
      { timeInSession: -1, text: "offline note" },
    ]);
    // The same words twice are two thoughts, so two ids.
    const ids = entry!.thoughts.slice(0, 3).map((thought) => thought.clientThoughtId);
    expect(new Set(ids).size).toBe(3);
    // Already saved when the first upload began, so every attempt sends them.
    expect(queuedAtFirstUpload).toEqual(entry!.thoughts.slice(0, 3));
    expect(captured).toEqual([
      { timeInSession: 12, text: "rain" },
      { timeInSession: 12, text: "rain" },
      { timeInSession: 30, text: "car door" },
    ]);

    // Saving the sit again, as the completion screen's retry does, keeps them.
    await coordinator.saveCompletedSession(baseRequest(), clientSessionId, testOwnerUserId, captured);
    expect((await store.loadEntries())[0]!.thoughts.slice(0, 3).map((thought) => thought.clientThoughtId))
      .toEqual(ids);
  });

  test("a batch the server stored before its upload timed out is sent again with the same ids, and each thought is stored once", async () => {
    vi.useFakeTimers();
    const server = stubServer({ stallBatches: 1 });
    const store = new InMemoryOfflineSessionQueueStore();
    const coordinator = new WebSessionSyncCoordinator(store, liveSessionSyncTransport());
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440041";

    const saving = coordinator.saveCompletedSession(baseRequest(), clientSessionId, testOwnerUserId, [
      { timeInSession: 12, text: "rain" },
      { timeInSession: 30, text: "car door" },
    ]);
    await server.batchStalled;
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);

    // The upload timed out, so the thoughts stay queued, though the server has them.
    expect(await saving).toMatchObject({ isPendingSync: true });
    const queued = (await store.loadEntries())[0]!.thoughts;
    expect(queued).toHaveLength(2);
    expect(server.stored).toEqual(queued);

    expect(await coordinator.flushPending(testOwnerUserId)).toBe(1);

    expect(server.batches.map((batch) => batch.thoughts)).toEqual([queued, queued]);
    expect(server.stored).toEqual(queued);
    expect((await store.loadEntries())[0]!.thoughts).toEqual([]);
  });

  test("an entry queued before ids existed still flushes, sending its thoughts as queued", async () => {
    const server = stubServer();
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440042";
    const legacyThoughts = [
      { timeInSession: 12, text: "rain" },
      { timeInSession: -1, text: "a note" },
    ];
    const store = new InMemoryOfflineSessionQueueStore();
    await store.saveEntries([{
      clientSessionId,
      ownerUserId: testOwnerUserId,
      request: requestWithClientId(baseRequest(), clientSessionId),
      thoughts: legacyThoughts,
      serverSessionId: null,
      sessionSynced: false,
      enqueuedAt: "2026-07-17T12:00:00.000Z",
    }]);

    expect(await new WebSessionSyncCoordinator(store, liveSessionSyncTransport()).flushPending(testOwnerUserId))
      .toBe(1);

    // No ids are backfilled: the batch is the one sent before #948.
    expect(server.batches).toEqual([{ sessionId: "server-948", dayNumber: 1, thoughts: legacyThoughts }]);
    expect((await store.loadEntries())[0]).toMatchObject({ sessionSynced: true, thoughts: [] });
  });

  test("a thought is acknowledged by its own id, not by another with the same time and text", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440043";
    const sent = { timeInSession: 12, text: "rain", clientThoughtId: "94800000-0000-4000-8000-000000000041" };
    const twin = { timeInSession: 12, text: "rain", clientThoughtId: "94800000-0000-4000-8000-000000000042" };
    await seedSyncedEntry(store, clientSessionId, [sent]);

    // A second thought with the same words is queued while the batch is out. A
    // new array, as an IndexedDB read would hand out: the in-memory store
    // shares the one this batch was built from.
    const transport: SessionSyncTransport = {
      ...alwaysFailingSessionSyncTransport,
      batchThoughts: async () => {
        const entries = await store.loadEntries();
        entries[0]!.thoughts = [...entries[0]!.thoughts, twin];
        await store.saveEntries(entries);
      },
    };

    await new WebSessionSyncCoordinator(store, transport).flushPending(testOwnerUserId);

    expect((await store.loadEntries())[0]!.thoughts).toEqual([twin]);
  });
});

describe("WebSessionSyncCoordinator return-home prune (#947)", () => {
  type CreatedSession = Awaited<ReturnType<SessionSyncTransport["createSession"]>>;

  /** Online for new sits, offline for thought batches: a row that still owes a
   *  batch stays owing it. */
  const sitsOnlyTransport: SessionSyncTransport = {
    createSession: async (payload) => ({ id: `server-${payload.clientSessionId}` }) as CreatedSession,
    batchThoughts: async () => {
      throw new TypeError("Network unavailable");
    },
  };

  /** One row per owing state, plus a clean one owned by someone else. */
  async function seedQueue(store: InMemoryOfflineSessionQueueStore): Promise<void> {
    const row = (
      clientSessionId: string,
      overrides: Partial<PendingSessionEntry> = {},
    ): PendingSessionEntry => ({
      clientSessionId,
      ownerUserId: testOwnerUserId,
      request: requestWithClientId(baseRequest(), clientSessionId),
      thoughts: [],
      serverSessionId: `server-${clientSessionId}`,
      sessionSynced: true,
      enqueuedAt: "2026-10-27T12:00:00.000Z",
      ...overrides,
    });
    await store.saveEntries([
      row("unsynced", { sessionSynced: false, serverSessionId: null }),
      row("synced"),
      row("queued-thoughts", { thoughts: [{ timeInSession: -1, text: "a note" }] }),
      row("pending-clear", { clearCompletionNote: true }),
      row("other-account", { ownerUserId: "user-other" }),
    ]);
  }

  const queuedIds = async (store: InMemoryOfflineSessionQueueStore) =>
    (await store.loadEntries()).map((entry) => entry.clientSessionId);

  test("drops the account's rows that owe nothing, after uploading what it can", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    await seedQueue(store);

    const synced = await new WebSessionSyncCoordinator(store, sitsOnlyTransport)
      .flushAndPruneCompleted(testOwnerUserId);

    // The unsynced sit uploaded on the way home, so it goes with the synced one.
    expect(synced).toBe(1);
    expect(await queuedIds(store)).toEqual(["queued-thoughts", "pending-clear", "other-account"]);
  });

  test("offline, every row that still owes the server stays", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    await seedQueue(store);

    await new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport)
      .flushAndPruneCompleted(testOwnerUserId);

    expect(await queuedIds(store)).toEqual(["unsynced", "queued-thoughts", "pending-clear", "other-account"]);
  });

  test("a sign-out during the flush prunes nothing", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    await seedQueue(store);

    await new WebSessionSyncCoordinator(store, sitsOnlyTransport)
      .flushAndPruneCompleted(testOwnerUserId, () => false);

    const entries = await store.loadEntries();
    expect(entries).toHaveLength(5);
    expect(entries.find((entry) => entry.clientSessionId === "unsynced")?.sessionSynced).toBe(true);
  });

  test("a permanent upload failure stays queued and does not stop the prune", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    await seedQueue(store);
    const refusing: SessionSyncTransport = {
      ...sitsOnlyTransport,
      createSession: async () => {
        throw Object.assign(new Error("rejected"), { permanent: true });
      },
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await new WebSessionSyncCoordinator(store, refusing).flushAndPruneCompleted(testOwnerUserId);

      expect(await queuedIds(store)).toEqual(["unsynced", "queued-thoughts", "pending-clear", "other-account"]);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  test("a sit the server refuses does not keep the sits queued after it from uploading", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    await seedQueue(store);
    const later = (await store.loadEntries())[0]!;
    await store.saveEntries([
      ...(await store.loadEntries()),
      { ...later, clientSessionId: "unsynced-later", request: requestWithClientId(baseRequest(), "unsynced-later") },
    ]);
    const refusingFirst: SessionSyncTransport = {
      ...sitsOnlyTransport,
      createSession: async (payload) => {
        if (payload.clientSessionId === "unsynced") {
          throw Object.assign(new Error("rejected"), { permanent: true });
        }
        return sitsOnlyTransport.createSession(payload);
      },
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const synced = await new WebSessionSyncCoordinator(store, refusingFirst)
        .flushAndPruneCompleted(testOwnerUserId);

      expect(synced).toBe(1);
      expect(await queuedIds(store)).toEqual(["unsynced", "queued-thoughts", "pending-clear", "other-account"]);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  test("flushPending parks the refusal and resolves with the sits behind it (#978)", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    await store.saveEntries([
      { clientSessionId: "refused", ownerUserId: testOwnerUserId, request: requestWithClientId(baseRequest(), "refused"), thoughts: [], serverSessionId: null, sessionSynced: false, enqueuedAt: "2026-10-27T12:00:00.000Z" },
      { clientSessionId: "accepted", ownerUserId: testOwnerUserId, request: requestWithClientId(baseRequest(), "accepted"), thoughts: [], serverSessionId: null, sessionSynced: false, enqueuedAt: "2026-10-27T12:00:00.000Z" },
    ]);
    const refusal = Object.assign(new Error("rejected"), { permanent: true });
    const coordinator = new WebSessionSyncCoordinator(store, {
      ...sitsOnlyTransport,
      createSession: async (payload) => {
        if (payload.clientSessionId === "refused") throw refusal;
        return sitsOnlyTransport.createSession(payload);
      },
    });

    await expect(coordinator.flushPending(testOwnerUserId)).resolves.toBe(1);
    const [refused, accepted] = await store.loadEntries();
    expect(refused?.parked).toMatchObject({ message: "rejected" });
    expect(accepted?.sessionSynced).toBe(true);
  });

  test("a row an open completion screen holds is kept until the hold is let go", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    await seedQueue(store);
    const coordinator = new WebSessionSyncCoordinator(store, sitsOnlyTransport);

    const release = coordinator.holdRowOpen("synced");
    try {
      await coordinator.flushAndPruneCompleted(testOwnerUserId);
      expect(await queuedIds(store)).toEqual(["synced", "queued-thoughts", "pending-clear", "other-account"]);
    } finally {
      release();
      release();
    }

    await coordinator.flushAndPruneCompleted(testOwnerUserId);
    expect(await queuedIds(store)).toEqual(["queued-thoughts", "pending-clear", "other-account"]);
  });

  test("a note edited after the sit synced, with the completion screen still open, saves; return home then prunes", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440947";
    // Saved offline, so the completion screen writes notes through the queue.
    const saved = await new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport)
      .saveCompletedSession(baseRequest(), clientSessionId, testOwnerUserId, []);
    expect(saved.isPendingSync).toBe(true);
    // A reconnect flush uploads it while the screen is open. Nothing prunes yet.
    const batches: SentBatch[] = [];
    const online: SessionSyncTransport = {
      createSession: sitsOnlyTransport.createSession,
      batchThoughts: async (data) => {
        batches.push(data);
      },
    };
    const coordinator = new WebSessionSyncCoordinator(store, online);
    expect(await coordinator.flushPending(testOwnerUserId)).toBe(1);

    await coordinator.replaceEndNote(clientSessionId, testOwnerUserId, "still here");
    expect(batches.map((batch) => batch.thoughts)).toEqual([[{ timeInSession: -1, text: "still here" }]]);

    await coordinator.flushAndPruneCompleted(testOwnerUserId);
    expect(await store.loadEntries()).toEqual([]);
  });
});

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

const rejectedSit = "550e8400-e29b-41d4-a716-446655449780";
const sitAhead = "550e8400-e29b-41d4-a716-446655449781";
const sitBehind = "550e8400-e29b-41d4-a716-446655449782";

/** A sit queued with one in-session thought and no server row yet. */
function queuedSit(clientSessionId: string): PendingSessionEntry {
  return {
    clientSessionId,
    ownerUserId: testOwnerUserId,
    request: requestWithClientId(baseRequest(), clientSessionId),
    thoughts: [{ timeInSession: 12, text: `a thought in ${clientSessionId}` }],
    serverSessionId: null,
    sessionSynced: false,
    enqueuedAt: "2026-10-27T09:00:00.000Z",
  };
}

/** The same sit once its session row exists, its thought still queued. */
function syncedSit(clientSessionId: string): PendingSessionEntry {
  return { ...queuedSit(clientSessionId), sessionSynced: true, serverSessionId: `server-${clientSessionId}` };
}

type RefusedUpload = { status: number; text: string };

/**
 * A stand-in for the API behind `liveSessionSyncTransport`. An upload `refuse`
 * names gets that answer; every other one succeeds, and a created session is
 * named after its sit. Returns each upload in order, as `<path> <id>`.
 */
function stubApi(refuse: (path: string, body: Record<string, unknown>) => RefusedUpload | undefined): string[] {
  const uploads: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const id = String(path === "/api/sessions" ? body.clientSessionId : body.sessionId);
    uploads.push(`${path} ${id}`);
    const refused = refuse(path, body);
    if (refused) return new Response(refused.text, { status: refused.status });
    const answer = path === "/api/sessions" ? { session: { id: `server-${id}` } } : { thoughts: [] };
    return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return uploads;
}

describe("WebSessionSyncCoordinator permanent answers (#978)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("a sit the server refuses with a permanent 4xx is parked, and the sits behind it still upload", async () => {
    const store = new CopyingQueueStore();
    await store.saveEntries([queuedSit(sitAhead), queuedSit(rejectedSit), queuedSit(sitBehind)]);
    const uploads = stubApi((path, body) =>
      path === "/api/sessions" && body.clientSessionId === rejectedSit
        ? { status: 400, text: '{"error":"Invalid track"}' }
        : undefined,
    );

    const flushed = await new WebSessionSyncCoordinator(store, liveSessionSyncTransport()).flushPending(testOwnerUserId);

    expect(flushed).toBe(2);
    expect(uploads).toEqual([
      `/api/sessions ${sitAhead}`,
      `/api/thoughts/batch server-${sitAhead}`,
      `/api/sessions ${rejectedSit}`,
      `/api/sessions ${sitBehind}`,
      `/api/thoughts/batch server-${sitBehind}`,
    ]);
    const [ahead, rejected, behind] = await store.loadEntries();
    expect(ahead).toEqual({ ...syncedSit(sitAhead), thoughts: [] });
    expect(behind).toEqual({ ...syncedSit(sitBehind), thoughts: [] });
    // Kept as it was queued, with the answer that turned it down.
    expect(rejected).toEqual({
      ...queuedSit(rejectedSit),
      parked: { at: expect.any(String), status: 400, message: '{"error":"Invalid track"}' },
    });
    expect(Number.isNaN(Date.parse(rejected!.parked!.at))).toBe(false);
  });

  test("a thoughts batch answered 404 parks its sit, and the next sit's thoughts still upload", async () => {
    const store = new CopyingQueueStore();
    await store.saveEntries([syncedSit(rejectedSit), syncedSit(sitBehind)]);
    const uploads = stubApi((path, body) =>
      path === "/api/thoughts/batch" && body.sessionId === `server-${rejectedSit}`
        ? { status: 404, text: '{"error":"Session not found"}' }
        : undefined,
    );

    const flushed = await new WebSessionSyncCoordinator(store, liveSessionSyncTransport()).flushPending(testOwnerUserId);

    expect(flushed).toBe(1);
    expect(uploads).toEqual([`/api/thoughts/batch server-${rejectedSit}`, `/api/thoughts/batch server-${sitBehind}`]);
    expect(await store.loadEntries()).toEqual([
      {
        ...syncedSit(rejectedSit),
        parked: { at: expect.any(String), status: 404, message: '{"error":"Session not found"}' },
      },
      { ...syncedSit(sitBehind), thoughts: [] },
    ]);
  });

  test("a sit whose session row went up before its thoughts were turned down still counts as synced", async () => {
    const store = new CopyingQueueStore();
    await store.saveEntries([queuedSit(rejectedSit)]);
    const uploads = stubApi((path) =>
      path === "/api/thoughts/batch" ? { status: 400, text: '{"error":"Invalid thoughts payload"}' } : undefined,
    );

    // The row moves the server's progression, so the flush still reports it
    // for `onSynced`.
    const flushed = await new WebSessionSyncCoordinator(store, liveSessionSyncTransport()).flushPending(testOwnerUserId);

    expect(flushed).toBe(1);
    expect(uploads).toEqual([`/api/sessions ${rejectedSit}`, `/api/thoughts/batch server-${rejectedSit}`]);
    expect(await store.loadEntries()).toEqual([
      {
        ...syncedSit(rejectedSit),
        parked: { at: expect.any(String), status: 400, message: '{"error":"Invalid thoughts payload"}' },
      },
    ]);
  });

  test("a queue that cannot be read after a refusal does not stop the sits behind it", async () => {
    const readFailure = new Error("queue unreadable");
    /** Fails the one read that follows the park being saved. */
    class FailsReadAfterParkStore extends CopyingQueueStore {
      private failNextLoad = false;
      private failed = false;
      override async loadEntries(): Promise<PendingSessionEntry[]> {
        if (this.failNextLoad) {
          this.failNextLoad = false;
          throw readFailure;
        }
        return super.loadEntries();
      }
      override async saveEntries(entries: PendingSessionEntry[]): Promise<void> {
        await super.saveEntries(entries);
        if (!this.failed && entries.some((entry) => entry.parked)) {
          this.failed = true;
          this.failNextLoad = true;
        }
      }
    }
    const store = new FailsReadAfterParkStore();
    await store.saveEntries([queuedSit(rejectedSit), queuedSit(sitBehind)]);
    const uploads = stubApi((path, body) =>
      path === "/api/sessions" && body.clientSessionId === rejectedSit
        ? { status: 400, text: '{"error":"Invalid track"}' }
        : undefined,
    );

    // The read failure is handed back once the sit behind has had its turn.
    await expect(new WebSessionSyncCoordinator(store, liveSessionSyncTransport()).flushPending(testOwnerUserId))
      .rejects.toBe(readFailure);
    expect(uploads).toEqual([
      `/api/sessions ${rejectedSit}`,
      `/api/sessions ${sitBehind}`,
      `/api/thoughts/batch server-${sitBehind}`,
    ]);
    expect((await store.loadEntries())[1]).toEqual({ ...syncedSit(sitBehind), thoughts: [] });
  });

  test.each([401, 403])("a %i leaves its sit queued as it was, and a later flush sends it", async (status) => {
    const store = new CopyingQueueStore();
    await store.saveEntries([queuedSit(rejectedSit), queuedSit(sitBehind)]);
    let signedOut = true;
    const uploads = stubApi((path, body) =>
      signedOut && path === "/api/sessions" && body.clientSessionId === rejectedSit
        ? { status, text: '{"error":"Unauthorized"}' }
        : undefined,
    );
    const coordinator = new WebSessionSyncCoordinator(store, liveSessionSyncTransport());

    // The sit behind it still uploads.
    expect(await coordinator.flushPending(testOwnerUserId)).toBe(1);
    expect((await store.loadEntries())[0]).toEqual(queuedSit(rejectedSit));
    expect(await coordinator.pendingCount(testOwnerUserId)).toBe(1);

    signedOut = false;
    expect(await coordinator.flushPending(testOwnerUserId)).toBe(1);

    expect(uploads).toEqual([
      `/api/sessions ${rejectedSit}`,
      `/api/sessions ${sitBehind}`,
      `/api/thoughts/batch server-${sitBehind}`,
      `/api/sessions ${rejectedSit}`,
      `/api/thoughts/batch server-${rejectedSit}`,
    ]);
    expect((await store.loadEntries())[0]).toEqual({ ...syncedSit(rejectedSit), thoughts: [] });
  });

  test("a parked sit is sent again by no flush, note edit or re-save", async () => {
    const store = new CopyingQueueStore();
    const uploads = stubApi(() => ({ status: 422, text: '{"error":"Invalid session"}' }));
    const coordinator = new WebSessionSyncCoordinator(store, liveSessionSyncTransport());

    // Refused on its first upload: the save rejects, as before, so the caller
    // still reports the sit as kept on this device (`resolveSessionSaveOutcome`).
    await expect(coordinator.saveCompletedSession(baseRequest(), rejectedSit, testOwnerUserId, []))
      .rejects.toMatchObject({ status: 422, permanent: true });
    expect((await store.loadEntries())[0]!.parked).toMatchObject({ status: 422 });

    expect(await coordinator.flushPending(testOwnerUserId)).toBe(0);
    await coordinator.replaceEndNote(rejectedSit, testOwnerUserId, "a note");
    expect(await coordinator.saveCompletedSession(baseRequest(), rejectedSit, testOwnerUserId, []))
      .toEqual({ sessionId: rejectedSit, isPendingSync: true, serverSessionId: null });

    expect(uploads).toEqual([`/api/sessions ${rejectedSit}`]);
    // The note is kept with the sit all the same.
    expect((await store.loadEntries())[0]!.thoughts).toEqual([{ timeInSession: -1, text: "a note" }]);
  });

  test("a parked sit keeps only the start of a long answer", async () => {
    const store = new CopyingQueueStore();
    await store.saveEntries([queuedSit(rejectedSit)]);
    // A proxy's error page, not the route's short JSON.
    const page = `<html><body>${"Request refused. ".repeat(40)}</body></html>`;
    stubApi(() => ({ status: 400, text: page }));

    await new WebSessionSyncCoordinator(store, liveSessionSyncTransport()).flushPending(testOwnerUserId);

    expect((await store.loadEntries())[0]!.parked!.message).toBe(page.slice(0, PARKED_MESSAGE_MAX_LENGTH));
  });

  test("a parked sit is not counted as pending, and pruning keeps it", async () => {
    const store = new CopyingQueueStore();
    await store.saveEntries([
      { ...syncedSit(rejectedSit), parked: { at: "2026-10-27T09:30:00.000Z", status: 404, message: "Session not found" } },
      queuedSit(sitBehind),
    ]);
    const coordinator = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);

    expect(await coordinator.pendingCount(testOwnerUserId)).toBe(1);
    await coordinator.pruneCompletedEntries(testOwnerUserId);
    expect((await store.loadEntries()).map((entry) => entry.clientSessionId)).toEqual([rejectedSit, sitBehind]);
  });
});
