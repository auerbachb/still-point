import { describe, expect, test, vi } from "vitest";
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
import type { PendingSessionEntry } from "./types";

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
      { timeInSession: 12, text: "mid-sit" },
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
   * the queue for `flushPending` to retry on reconnect, and the error must NOT be
   * a `LocalSessionWriteError` — that tag is what makes the caller say "nowhere".
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
    expect(entry!.thoughts).toEqual([{ timeInSession: 12, text: "mid-sit" }]);
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
