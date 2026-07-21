import { describe, expect, test } from "vitest";
import { InMemoryOfflineSessionQueueStore } from "./queueStore";
import {
  SessionSyncError,
  WebSessionSyncCoordinator,
  alwaysFailingSessionSyncTransport,
  provisionalSessionId,
  requestWithClientId,
} from "./sessionSyncCoordinator";
import type { SessionSyncTransport } from "./transport";

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

  test("appendEndNote queues note for pending entry", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const coordinator = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440005";

    await coordinator.saveCompletedSession(baseRequest(), clientSessionId, testOwnerUserId, []);
    await coordinator.appendEndNote(clientSessionId, testOwnerUserId, "offline note");

    const entries = await store.loadEntries();
    expect(entries[0]!.thoughts).toEqual([{ timeInSession: -1, text: "offline note" }]);
  });

  test("appendEndNote rejects owner mismatch", async () => {
    const store = new InMemoryOfflineSessionQueueStore();
    const coordinator = new WebSessionSyncCoordinator(store, alwaysFailingSessionSyncTransport);
    const clientSessionId = "550e8400-e29b-41d4-a716-446655440006";

    await coordinator.saveCompletedSession(baseRequest(), clientSessionId, testOwnerUserId, []);

    await expect(
      coordinator.appendEndNote(clientSessionId, "other-user", "note"),
    ).rejects.toThrow(SessionSyncError);
  });
});
