import {
  LocalSessionWriteError,
  SessionSyncError,
} from "@/lib/offlineSessionQueue/sessionSyncCoordinator";
import type { SavedSessionResult } from "@/lib/offlineSessionQueue/types";

/**
 * #703: what actually happened to a finished sit, as three states the UI can
 * tell apart.
 *
 * Before this existed the caller collapsed a thrown save into `isPendingSync`,
 * the same value a *successful* offline queue write produces — so a sit that
 * IndexedDB refused was reported to the user as safely queued, and they had no
 * reason to retry anything.
 *
 * - `synced`   — the server has it.
 * - `pending`  — it is durably on this device and will upload on reconnect.
 * - `notStored`— it is nowhere. No session id, because there is no session to
 *                point at: handing back the client id here is what made the
 *                failure look like a success.
 */
export type SessionSaveOutcome =
  | { status: "synced"; sessionId: string }
  | { status: "pending"; sessionId: string }
  | { status: "notStored"; sessionId: null };

/**
 * Map a settled `saveCompletedSession` call to its outcome.
 *
 * A rejection is only `notStored` when the sit genuinely never reached the
 * device, and the coordinator says which case it is by the error it throws:
 *
 * - `LocalSessionWriteError` — IndexedDB refused the write. Nothing was stored.
 * - `SessionSyncError` — a validation guard (`missingOwnerUserId`,
 *   `ownerMismatch`) that rejects before this user has an entry of their own.
 * - anything else — in practice a `permanent` transport error, which the
 *   coordinator rethrows out of `flushEntry`. This one is thrown *after* the
 *   queue write succeeded, so the entry is durably on this device and
 *   `flushPending` will retry it on reconnect. Calling it `notStored` is the
 *   same false report as #703, only inverted: it hides a sit that is safe and
 *   withdraws a promise the queue is in fact keeping.
 *
 * `clientSessionId` is the sit's #557 idempotency key, which is exactly what a
 * durable-but-unsent entry is keyed by — the same provisional id the
 * coordinator returns for an ordinary offline save.
 */
export function resolveSessionSaveOutcome(
  settled: PromiseSettledResult<SavedSessionResult>,
  clientSessionId: string,
): SessionSaveOutcome {
  if (settled.status === "rejected") {
    const nothingStored = settled.reason instanceof LocalSessionWriteError
      || settled.reason instanceof SessionSyncError;
    return nothingStored
      ? { status: "notStored", sessionId: null }
      : { status: "pending", sessionId: clientSessionId };
  }

  const result = settled.value;
  return result.isPendingSync
    ? { status: "pending", sessionId: result.sessionId }
    : { status: "synced", sessionId: result.sessionId };
}

/** True while the sit exists somewhere — on the server or on this device. */
export function isSessionStored(outcome: SessionSaveOutcome): boolean {
  return outcome.status !== "notStored";
}
