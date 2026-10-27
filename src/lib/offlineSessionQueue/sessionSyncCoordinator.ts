import { OFFLINE_QUEUE_LOCK_NAME, OFFLINE_SYNC_TAG } from "./constants";
import { defaultOfflineSessionQueueStore } from "./idbStore";
import type { OfflineSessionQueueStore } from "./queueStore";
import {
  alwaysFailingSessionSyncTransport,
  isNetworkFailure,
  liveSessionSyncTransport,
  type SessionSyncTransport,
} from "./transport";
import type {
  CreateSessionPayload,
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

  async pendingCount(ownerUserId: string): Promise<number> {
    const entries = await this.queueStore.loadEntries();
    return entries.filter(
      (entry) => entry.ownerUserId === ownerUserId && awaitsSync(entry),
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
          thoughts,
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

  async flushPending(ownerUserId: string): Promise<number> {
    if (!ownerUserId) return 0;

    const entries = await this.queueStore.loadEntries();
    let syncedCount = 0;
    for (const entry of entries) {
      if (entry.ownerUserId !== ownerUserId) continue;
      if (!awaitsSync(entry)) continue;
      // #792: in the same turn as note edits — in every tab (#834) — so an edit
      // can never land between this upload and the queue update that follows
      // it, and a clear can never reach the server ahead of the note it is
      // meant to delete. One sit per turn: `flushEntry` re-reads the queue.
      const flushed = await withQueueMutation(() => this.flushEntry(entry.clientSessionId, ownerUserId));
      if (flushed) syncedCount += 1;
    }
    return syncedCount;
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
      const entries = await this.queueStore.loadEntries();
      const next = entries.filter(
        (entry) => !(entry.ownerUserId === ownerUserId && !awaitsSync(entry)),
      );
      if (next.length !== entries.length) {
        await this.queueStore.saveEntries(next);
      }
    });
  }

  async clearQueue(): Promise<void> {
    // #834: in turn too, so a flush that was mid-upload at sign-out cannot save
    // its earlier read back over the cleared queue.
    return withQueueMutation(() => this.queueStore.saveEntries([]));
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
    if (!entry) return null;

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
        if (isNetworkFailure(error)) return null;
        if (error && typeof error === "object" && "permanent" in error) throw error;
        return null;
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
          (thought) =>
            !sent.some(
              (item) => item.timeInSession === thought.timeInSession && item.text === thought.text,
            ),
        );
        const clearDelivered = sentClear && current.clearCompletionNote === true;
        if (remaining.length === current.thoughts.length && !clearDelivered) return current;
        current.thoughts = remaining;
        if (clearDelivered) current.clearCompletionNote = false;
        await this.queueStore.saveEntries(entries);
        entry = current;
      } catch (error) {
        if (isNetworkFailure(error)) return null;
        if (error && typeof error === "object" && "permanent" in error) throw error;
        return null;
      }
    }

    return entry;
  }
}

let sharedCoordinator: WebSessionSyncCoordinator | null = null;
let queueMutation: Promise<unknown> = Promise.resolve();

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
