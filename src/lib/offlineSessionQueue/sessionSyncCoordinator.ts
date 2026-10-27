import {
  OFFLINE_OPEN_ROW_LOCK_PREFIX,
  OFFLINE_QUEUE_LOCK_NAME,
  OFFLINE_SYNC_TAG,
  PARKED_MESSAGE_MAX_LENGTH,
} from "./constants";
import { defaultOfflineSessionQueueStore } from "./idbStore";
import type { OfflineSessionQueueStore } from "./queueStore";
import {
  alwaysFailingSessionSyncTransport,
  failureStatus,
  isNetworkFailure,
  isPermanentFailure,
  liveSessionSyncTransport,
  type SessionSyncTransport,
} from "./transport";
import type {
  CreateSessionPayload,
  ParkedSession,
  PendingSessionEntry,
  PendingSessionThought,
  SavedSessionResult,
} from "./types";

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

function requestWithClientId(
  request: Omit<CreateSessionPayload, "clientSessionId">,
  clientSessionId: string,
): CreateSessionPayload {
  return { ...request, clientSessionId };
}

function provisionalSessionId(clientSessionId: string): string {
  return clientSessionId;
}

/** The entry still owes the server something: its session row, queued
 *  thoughts, or a completion-note clear (#792). */
function awaitsSync(entry: PendingSessionEntry): boolean {
  return !entry.sessionSynced || entry.thoughts.length > 0 || entry.clearCompletionNote === true;
}

/** #948: an id for each in-session thought, given before the entry is first
 *  saved, so every upload of it sends the same one. A batch the server stored
 *  but whose response was lost (`UPLOAD_TIMEOUT_MS`, a dropped connection) is
 *  then not stored twice when it is sent again. The end note gets none: the
 *  server replaces it instead. */
function withClientThoughtIds(thoughts: PendingSessionThought[]): PendingSessionThought[] {
  return thoughts.map((thought) =>
    thought.timeInSession === -1 || thought.clientThoughtId
      ? thought
      : { ...thought, clientThoughtId: crypto.randomUUID() },
  );
}

/** #948: whether a thought the batch sent is this queued one. A thought with an
 *  id is matched by it. One queued before ids existed, and the end note, are
 *  matched by time and text, as before. */
function isSameThought(sent: PendingSessionThought, queued: PendingSessionThought): boolean {
  if (sent.clientThoughtId || queued.clientThoughtId) {
    return sent.clientThoughtId === queued.clientThoughtId;
  }
  return sent.timeInSession === queued.timeInSession && sent.text === queued.text;
}

/** #978: the server turned this sit down for good, so no flush sends it again. */
function isParked(entry: PendingSessionEntry): boolean {
  return Boolean(entry.parked);
}

/**
 * #978: whether a permanent answer is about the sit itself. A 401 means the
 * sign-in lapsed, and neither route answers 403, so one comes from in front of
 * them. A later flush can get past both, so those entries stay queued. Any
 * other permanent answer (a validation 400, the 404 for a session that is gone,
 * …) would be the same every time.
 */
function rejectsTheSit(error: unknown): boolean {
  const status = failureStatus(error);
  return status !== 401 && status !== 403;
}

/** #978: what a parked entry keeps of the answer that parked it. */
function parkedBy(error: unknown): ParkedSession {
  const message = error instanceof Error ? error.message : String(error);
  return {
    at: new Date().toISOString(),
    status: failureStatus(error),
    message: message.slice(0, PARKED_MESSAGE_MAX_LENGTH),
  };
}

export class WebSessionSyncCoordinator {
  private readonly queueStore: OfflineSessionQueueStore;
  private readonly transport: SessionSyncTransport;

  constructor(
    queueStore: OfflineSessionQueueStore = defaultOfflineSessionQueueStore(),
    transport: SessionSyncTransport = liveSessionSyncTransport(),
  ) {
    this.queueStore = queueStore;
    this.transport = transport;
  }

  /** Sits a flush will still upload. #978: a parked sit stays queued but is not
   *  counted, since no flush sends it again. */
  async pendingCount(ownerUserId: string): Promise<number> {
    const entries = await this.queueStore.loadEntries();
    return entries.filter(
      (entry) => entry.ownerUserId === ownerUserId && awaitsSync(entry) && !isParked(entry),
    ).length;
  }

  async saveCompletedSession(
    request: Omit<CreateSessionPayload, "clientSessionId">,
    clientSessionId: string,
    ownerUserId: string,
    thoughts: PendingSessionThought[],
  ): Promise<SavedSessionResult> {
    if (!ownerUserId) {
      throw new SessionSyncError("missingOwnerUserId");
    }

    return withQueueMutation(async () => {
      // #703: a store that cannot even be read is a store nothing was written
      // to. Tagged like the write below so the caller classifies it as
      // notStored — an untagged throw from here would be read as a *post-write*
      // sync failure and reported as safely queued, which is the exact false
      // reassurance this ticket is about.
      let entries: PendingSessionEntry[];
      try {
        entries = await this.queueStore.loadEntries();
      } catch (error) {
        throw new LocalSessionWriteError("queueReadFailed", { cause: error });
      }
      const existingIndex = entries.findIndex((entry) => entry.clientSessionId === clientSessionId);

      if (existingIndex >= 0) {
        const existing = entries[existingIndex]!;
        if (existing.ownerUserId !== ownerUserId) {
          throw new SessionSyncError("ownerMismatch");
        }
        if (!awaitsSync(existing) && existing.serverSessionId) {
          return {
            sessionId: existing.serverSessionId,
            isPendingSync: false,
            serverSessionId: existing.serverSessionId,
          };
        }
      } else {
        entries.push({
          clientSessionId,
          ownerUserId,
          request: requestWithClientId(request, clientSessionId),
          thoughts: withClientThoughtIds(thoughts),
          serverSessionId: null,
          sessionSynced: false,
          enqueuedAt: new Date().toISOString(),
        });
        try {
          await this.queueStore.saveEntries(entries);
        } catch (error) {
          // #703: the sit never reached the device. Tagged so the caller can tell
          // this apart from a queued-but-unsent sit and say so to the user.
          throw new LocalSessionWriteError("queueWriteFailed", { cause: error });
        }
        await requestBackgroundSync();
      }

      const synced = await this.flushEntry(clientSessionId, ownerUserId);
      if (synced) {
        return {
          sessionId: synced.serverSessionId!,
          isPendingSync: false,
          serverSessionId: synced.serverSessionId,
        };
      }

      return {
        sessionId: provisionalSessionId(clientSessionId),
        isPendingSync: true,
        serverSessionId: null,
      };
    });
  }

  /** Set the end note of a queued or already-synced sit. */
  async replaceEndNote(clientSessionId: string, ownerUserId: string, note: string): Promise<void> {
    const trimmed = note.trim();
    if (!trimmed) return;
    return this.writeEndNote(clientSessionId, ownerUserId, trimmed);
  }

  /** #792: remove the end note of a queued or already-synced sit. */
  async clearEndNote(clientSessionId: string, ownerUserId: string): Promise<void> {
    return this.writeEndNote(clientSessionId, ownerUserId, null);
  }

  /** Rejects with the first failure other than a permanent answer, once every
   *  other sit has had its turn. #978: a sit the server turns down for good is
   *  parked (or, after a 401 or 403, left queued) and does not fail the flush. */
  async flushPending(ownerUserId: string): Promise<number> {
    const { syncedCount, failure } = await this.flushEachPending(ownerUserId);
    if (failure) throw failure.error;
    return syncedCount;
  }

  /** #947: one sit the server refuses does not keep the sits after it from
   *  uploading. The first refusal (#978: a permanent answer) and the first other
   *  failure are handed back for the caller to report. */
  private async flushEachPending(ownerUserId: string): Promise<{
    syncedCount: number;
    failure: { error: unknown } | null;
    refusal: { error: unknown } | null;
  }> {
    if (!ownerUserId) return { syncedCount: 0, failure: null, refusal: null };

    const entries = await this.queueStore.loadEntries();
    let syncedCount = 0;
    let failure: { error: unknown } | null = null;
    let refusal: { error: unknown } | null = null;
    for (const entry of entries) {
      if (entry.ownerUserId !== ownerUserId) continue;
      if (!awaitsSync(entry)) continue;
      // #792: in the same turn as note edits — in every tab (#834) — so an edit
      // can never land between this upload and the queue update that follows
      // it, and a clear can never reach the server ahead of the note it is
      // meant to delete. One sit per turn: `flushEntry` re-reads the queue.
      try {
        const flushed = await withQueueMutation(() => this.flushEntry(entry.clientSessionId, ownerUserId));
        if (flushed) syncedCount += 1;
      } catch (error) {
        // #978: a permanent answer stops only this sit. `flushEntry` has parked
        // it, or left it queued after a 401 or 403, so the sits behind it still
        // upload and the flush still resolves with the sits that synced.
        if (isPermanentFailure(error)) {
          refusal ??= { error };
          // Its session row can have gone up before its thoughts were turned
          // down. The row moves the server's progression all the same, so the
          // sit counts and `onSynced` still runs.
          if (!entry.sessionSynced && (await this.resolvedServerSessionId(entry.clientSessionId, ownerUserId))) {
            syncedCount += 1;
          }
        } else {
          // #947: any other failure, such as a queue that cannot be read or a
          // park that cannot be saved, is handed back once every sit has had
          // its turn.
          failure ??= { error };
        }
      }
    }
    return { syncedCount, failure, refusal };
  }

  /**
   * #947: marks a sit's row as still in use by an open completion screen, whose
   * note edits find a pending sit by its row. While held, in this tab or any
   * other, the return-home prune keeps the row. Call the returned function once
   * the screen's writes have settled; calling it again does nothing.
   */
  holdRowOpen(clientSessionId: string): () => void {
    openRowsInTab.set(clientSessionId, (openRowsInTab.get(clientSessionId) ?? 0) + 1);
    let released = false;
    let releaseLock: (() => void) | null = null;
    const locks = queueLockManager();
    if (locks) {
      void locks
        .request(`${OFFLINE_OPEN_ROW_LOCK_PREFIX}${clientSessionId}`, { mode: "shared" }, () =>
          new Promise<void>((resolve) => {
            if (released) resolve();
            else releaseLock = resolve;
          }),
        )
        .catch(() => {});
    }
    return () => {
      if (released) return;
      released = true;
      const count = (openRowsInTab.get(clientSessionId) ?? 1) - 1;
      if (count > 0) openRowsInTab.set(clientSessionId, count);
      else openRowsInTab.delete(clientSessionId);
      releaseLock?.();
    };
  }

  async resolvedServerSessionId(clientSessionId: string, ownerUserId: string): Promise<string | null> {
    const entry = (await this.queueStore.loadEntries()).find(
      (item) => item.clientSessionId === clientSessionId && item.ownerUserId === ownerUserId,
    );
    return entry?.serverSessionId ?? null;
  }

  async pruneCompletedEntries(ownerUserId: string): Promise<void> {
    if (!ownerUserId) return;
    // #792: in turn with note edits and flushes. Saved from a stale read, the
    // filtered list would drop an entry whose clear was flagged in between.
    return withQueueMutation(async () => {
      // #947: read in the same turn, so a screen that holds its row by now is seen.
      const open = await rowsHeldOpen();
      if (!open) return;
      const entries = await this.queueStore.loadEntries();
      const next = entries.filter(
        (entry) =>
          !(entry.ownerUserId === ownerUserId && !awaitsSync(entry) && !open.has(entry.clientSessionId)),
      );
      if (next.length !== entries.length) {
        await this.queueStore.saveEntries(next);
      }
    });
  }

  /**
   * #947: the return-home sync, as iOS's `returnHome()` runs it. Uploads what
   * this account still owes, then drops its rows that owe nothing more — a
   * synced sit otherwise stays queued until sign-out. Resolves to the number of
   * sits the flush uploaded.
   *
   * A completion screen's note edits find a pending sit by its row, and
   * `writeEndNote` throws `entryNotFound` without one, so a row held with
   * `holdRowOpen` — by this tab or another — is kept. `isCurrent` is read
   * between the flush and the prune; false means the account signed out (or
   * another signed in) in the meantime, so nothing is pruned for a session that
   * has ended.
   */
  async flushAndPruneCompleted(
    ownerUserId: string,
    isCurrent: () => boolean = () => true,
  ): Promise<number> {
    if (!ownerUserId) return 0;
    const { syncedCount, failure, refusal } = await this.flushEachPending(ownerUserId);
    const reported = failure ?? refusal;
    if (reported) {
      // A permanent upload failure leaves its row queued (#978: parked) and does
      // not stop the prune: it only drops rows that owe nothing, so the failed
      // one stays.
      console.error("Failed to flush the offline session queue:", reported.error);
    }
    if (!isCurrent()) return syncedCount;
    await this.pruneCompletedEntries(ownerUserId);
    return syncedCount;
  }

  async clearQueue(): Promise<void> {
    // #666: sign-out empties the queue now, not once an upload in flight in some
    // tab settles, which can take up to `UPLOAD_TIMEOUT_MS` per request (#907).
    // #834: and again in turn, so a flush that was mid-upload at sign-out cannot
    // save its earlier read back over the cleared queue.
    await Promise.all([
      withQueueMutation(() => this.queueStore.saveEntries([])),
      this.queueStore.saveEntries([]),
    ]);
  }

  /** `note` null clears it. Either way the queue keeps at most one end note
   *  and never touches the sit's in-session thoughts. */
  private async writeEndNote(
    clientSessionId: string,
    ownerUserId: string,
    note: string | null,
  ): Promise<void> {
    if (!ownerUserId) {
      throw new SessionSyncError("missingOwnerUserId");
    }

    return withQueueMutation(async () => {
      const entries = await this.queueStore.loadEntries();
      const index = entries.findIndex((entry) => entry.clientSessionId === clientSessionId);
      if (index < 0) {
        throw new SessionSyncError("entryNotFound");
      }
      const entry = entries[index]!;
      if (entry.ownerUserId !== ownerUserId) {
        throw new SessionSyncError("ownerMismatch");
      }

      // #753: autosave can run again as the note is edited. Keep one end note
      // and replace its text. A second -1 in the same batch is rejected.
      const kept = entry.thoughts.filter((thought) => thought.timeInSession !== -1);
      if (note !== null) kept.push({ timeInSession: -1, text: note });
      entry.thoughts = kept;
      // #792: a new note replaces the stored one server-side, so only a clear
      // needs the flag — and only once the sit has a server row that could hold
      // a note. Before that, dropping the queued note is the whole clear.
      entry.clearCompletionNote = note === null && entry.sessionSynced;
      await this.queueStore.saveEntries(entries);
      await requestBackgroundSync();
      await this.flushEntry(clientSessionId, ownerUserId);
    });
  }

  private async flushEntry(
    clientSessionId: string,
    ownerUserId: string,
  ): Promise<PendingSessionEntry | null> {
    let entry = (await this.queueStore.loadEntries()).find(
      (item) => item.clientSessionId === clientSessionId && item.ownerUserId === ownerUserId,
    );
    // #978: sent again, a parked sit would only get the same answer.
    if (!entry || isParked(entry)) return null;

    if (!entry.sessionSynced) {
      try {
        const session = await this.transport.createSession(entry.request);
        const entries = await this.queueStore.loadEntries();
        const index = entries.findIndex(
          (item) => item.clientSessionId === clientSessionId && item.ownerUserId === ownerUserId,
        );
        if (index < 0) return null;
        entries[index]!.serverSessionId = session.id;
        entries[index]!.sessionSynced = true;
        await this.queueStore.saveEntries(entries);
        entry = entries[index]!;
      } catch (error) {
        return this.uploadFailed(error, clientSessionId, ownerUserId);
      }
    }

    const serverSessionId = entry.serverSessionId;
    if (!serverSessionId) return null;

    entry = (await this.queueStore.loadEntries()).find(
      (item) => item.clientSessionId === clientSessionId && item.ownerUserId === ownerUserId,
    ) ?? entry;

    const sentClear = entry.clearCompletionNote === true;
    if (entry.thoughts.length > 0 || sentClear) {
      const sent = entry.thoughts;
      try {
        await this.transport.batchThoughts({
          sessionId: serverSessionId,
          dayNumber: entry.request.dayNumber,
          thoughts: sent,
          ...(sentClear ? { clearCompletionNote: true as const } : {}),
        });
        const entries = await this.queueStore.loadEntries();
        const index = entries.findIndex(
          (item) => item.clientSessionId === clientSessionId && item.ownerUserId === ownerUserId,
        );
        if (index < 0) return entry;
        const current = entries[index]!;
        // Only drop what this batch sent. A note replaced while the request was
        // in flight (#753 autosave) stays queued for the next flush, and a clear
        // asked for after a request that carried none stays set (#792).
        const remaining = current.thoughts.filter(
          (thought) => !sent.some((item) => isSameThought(item, thought)),
        );
        const clearDelivered = sentClear && current.clearCompletionNote === true;
        if (remaining.length === current.thoughts.length && !clearDelivered) return current;
        current.thoughts = remaining;
        if (clearDelivered) current.clearCompletionNote = false;
        await this.queueStore.saveEntries(entries);
        entry = current;
      } catch (error) {
        return this.uploadFailed(error, clientSessionId, ownerUserId);
      }
    }

    return entry;
  }

  /**
   * How `flushEntry` ends after a failed upload. A network failure or a
   * retryable answer leaves the entry queued for the next flush. So does a
   * queue read or write that fails just after an upload went through: the next
   * flush sends it again, as after a lost response (#557, #948). A permanent
   * answer is rethrown to the caller. #978: unless it is a 401 or 403, the
   * entry is parked first.
   */
  private async uploadFailed(error: unknown, clientSessionId: string, ownerUserId: string): Promise<null> {
    if (isNetworkFailure(error) || !isPermanentFailure(error)) return null;
    if (rejectsTheSit(error)) await this.park(clientSessionId, ownerUserId, error);
    throw error;
  }

  /** #978: keeps the sit, with the answer that turned it down, where no flush
   *  sends it again. Runs in the caller's queue turn, like the rest of
   *  `flushEntry`. */
  private async park(clientSessionId: string, ownerUserId: string, error: unknown): Promise<void> {
    const entries = await this.queueStore.loadEntries();
    const entry = entries.find(
      (item) => item.clientSessionId === clientSessionId && item.ownerUserId === ownerUserId,
    );
    if (!entry) return;
    entry.parked = parkedBy(error);
    await this.queueStore.saveEntries(entries);
  }
}

let sharedCoordinator: WebSessionSyncCoordinator | null = null;
let queueMutation: Promise<unknown> = Promise.resolve();
/** #947: this tab's open completion screens, by sit, with a count per sit.
 *  Covers the tab itself where Web Locks is missing. */
const openRowsInTab = new Map<string, number>();

/** #947: the sits whose rows an open completion screen still needs: this tab's,
 *  plus every lock any tab holds or has asked for. Null when the other tabs'
 *  locks could not be read, so nothing is known safe to drop. */
async function rowsHeldOpen(): Promise<Set<string> | null> {
  const open = new Set(openRowsInTab.keys());
  const locks = queueLockManager();
  if (!locks || typeof locks.query !== "function") return open;
  try {
    const snapshot = await locks.query();
    for (const lock of [...(snapshot.held ?? []), ...(snapshot.pending ?? [])]) {
      if (lock.name?.startsWith(OFFLINE_OPEN_ROW_LOCK_PREFIX)) {
        open.add(lock.name.slice(OFFLINE_OPEN_ROW_LOCK_PREFIX.length));
      }
    }
  } catch {
    return null;
  }
  return open;
}

/**
 * Runs queue writes one at a time, in call order.
 *
 * #834: the queue lives in IndexedDB, which every tab and the service worker
 * share, so where the browser has Web Locks the turn is an exclusive lock they
 * all take. The in-memory chain orders only this tab's writes; it is the
 * fallback where Web Locks is missing (outside a secure context, in older
 * browsers, in tests).
 */
async function withQueueMutation<T>(fn: () => Promise<T>): Promise<T> {
  const locks = queueLockManager();
  if (!locks) return withTabQueueMutation(fn);
  let granted = false;
  try {
    return await locks.request(OFFLINE_QUEUE_LOCK_NAME, () => {
      granted = true;
      return fn();
    });
  } catch (error) {
    // A lock that was never granted ran nothing, so the write can still take
    // this tab's turn. Rejecting instead would hand `saveCompletedSession` an
    // untagged error, which reads as a queued sit with nothing stored (#703).
    if (granted) throw error;
    return withTabQueueMutation(fn);
  }
}

function withTabQueueMutation<T>(fn: () => Promise<T>): Promise<T> {
  const result = queueMutation.then(fn);
  queueMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Read on every call. The DOM types declare `navigator.locks` always
 *  present, but it is missing outside a secure context. */
function queueLockManager(): LockManager | null {
  if (typeof navigator === "undefined") return null;
  const locks = navigator.locks as LockManager | undefined;
  return typeof locks?.request === "function" ? locks : null;
}

export function getWebSessionSyncCoordinator(): WebSessionSyncCoordinator {
  if (!sharedCoordinator) {
    sharedCoordinator = new WebSessionSyncCoordinator();
  }
  return sharedCoordinator;
}

export async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000)),
    ]);
    if (!registration || !("sync" in registration)) {
      return;
    }
    await (registration as ServiceWorkerRegistration & {
      sync: { register: (tag: string) => Promise<void> };
    }).sync.register(OFFLINE_SYNC_TAG);
  } catch {
    // Background Sync is best-effort; foreground online flush covers unsupported browsers.
  }
}

export {
  alwaysFailingSessionSyncTransport,
  provisionalSessionId,
  requestWithClientId,
};
