export class SessionSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionSyncError";
  }
}

/**
 * #703: the local queue write failed, so the sit is NOT on this device.
 *
 * Distinct from both siblings on purpose. `SessionSyncError` is a validation
 * guard, and a *network* failure is not an error at all here — the entry is
 * already durable, so it resolves normally with `isPendingSync: true`. This one
 * is the case where IndexedDB itself was unusable (private browsing, exhausted
 * quota, an evicted or corrupted object store) for either the read or the write,
 * which means nothing was stored and nothing will upload later.
 *
 * It carries the whole weight of the notStored verdict: `resolveSessionSaveOutcome`
 * treats an *untagged* rejection as `pending`, because the only other way out of
 * `saveCompletedSession` is a sync error raised after the entry is durable.
 */
export class LocalSessionWriteError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LocalSessionWriteError";
  }
}
