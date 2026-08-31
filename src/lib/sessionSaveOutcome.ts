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
 * Any rejection is `notStored`. The coordinator throws for a refused local write
 * (`LocalSessionWriteError`), for a validation guard (`SessionSyncError`), and
 * for a `permanent` transport error — and in none of those cases is the local
 * entry's durability something we can promise. The coordinator's normal return
 * is the only thing that produces `pending`, because it is the only signal that
 * the write landed.
 */
export function resolveSessionSaveOutcome(
  settled: PromiseSettledResult<SavedSessionResult>,
): SessionSaveOutcome {
  if (settled.status === "rejected") {
    return { status: "notStored", sessionId: null };
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
