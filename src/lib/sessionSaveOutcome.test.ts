/**
 * Issue #703 — a failed offline queue write must not read as "queued".
 *
 * The regression these lock down: `handleSessionComplete` used to catch a thrown
 * save and set `isPendingSync = true`, the same value a successful queue write
 * produces, so a sit that was never stored was reported to the user as safely
 * waiting to upload.
 */
import { describe, expect, test } from "vitest";
import {
  LocalSessionWriteError,
  SessionSyncError,
} from "@/lib/offlineSessionQueue/sessionSyncCoordinator";
import { isSessionStored, resolveSessionSaveOutcome } from "@/lib/sessionSaveOutcome";
import type { SavedSessionResult } from "@/lib/offlineSessionQueue/types";

const clientSessionId = "550e8400-e29b-41d4-a716-446655440703";

function pendingResult(): SavedSessionResult {
  return { sessionId: clientSessionId, isPendingSync: true, serverSessionId: null };
}

function syncedResult(): SavedSessionResult {
  return { sessionId: "server-session-703", isPendingSync: false, serverSessionId: "server-session-703" };
}

describe("resolveSessionSaveOutcome (#703)", () => {
  test("a refused local write is notStored, never pending", () => {
    const outcome = resolveSessionSaveOutcome({
      status: "rejected",
      reason: new LocalSessionWriteError("queueWriteFailed", { cause: new Error("QuotaExceededError") }),
    }, clientSessionId);

    expect(outcome.status).toBe("notStored");
    expect(outcome.status).not.toBe("pending");
    expect(outcome.sessionId).toBeNull();
    expect(isSessionStored(outcome)).toBe(false);
  });

  test("a validation guard is notStored — it rejects before this user has an entry", () => {
    for (const message of ["missingOwnerUserId", "ownerMismatch"]) {
      const outcome = resolveSessionSaveOutcome({
        status: "rejected",
        reason: new SessionSyncError(message),
      }, clientSessionId);

      expect(outcome.status).toBe("notStored");
      expect(outcome.sessionId).toBeNull();
    }
  });

  /**
   * The inverse of the #703 regression: the queue write landed and only the
   * *upload* was refused (a non-retryable 4xx, which the coordinator rethrows
   * out of `flushEntry`). The sit is on this device and `flushPending` retries
   * it on reconnect, so calling it notStored would hide a safe sit and withdraw
   * a promise the queue is keeping.
   */
  test("a sync error thrown after a durable write is pending, not notStored", () => {
    for (const reason of [
      Object.assign(new Error("Create session failed (400)"), { permanent: true }),
      new Error("boom"),
      "string rejection",
      undefined,
    ]) {
      const outcome = resolveSessionSaveOutcome({ status: "rejected", reason }, clientSessionId);

      expect(outcome.status).toBe("pending");
      expect(outcome.status).not.toBe("notStored");
      expect(outcome.sessionId).toBe(clientSessionId);
      expect(isSessionStored(outcome)).toBe(true);
    }
  });

  test("a durably queued sit stays pending, with its session id", () => {
    const outcome = resolveSessionSaveOutcome(
      { status: "fulfilled", value: pendingResult() },
      clientSessionId,
    );

    expect(outcome.status).toBe("pending");
    expect(outcome.sessionId).toBe(clientSessionId);
    expect(isSessionStored(outcome)).toBe(true);
  });

  test("a synced sit stays synced, with the server id", () => {
    const outcome = resolveSessionSaveOutcome(
      { status: "fulfilled", value: syncedResult() },
      clientSessionId,
    );

    expect(outcome.status).toBe("synced");
    expect(outcome.sessionId).toBe("server-session-703");
    expect(isSessionStored(outcome)).toBe(true);
  });
});
