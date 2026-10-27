import { requestBackgroundSync } from "./backgroundSync";
import { defaultOfflineSessionQueueStore } from "./idbStore";
import { LocalSessionWriteError, SessionSyncError } from "./errors";
import {
  applyEndNote,
  awaitsSync,
  findOwnedEntry,
  findOwnedEntryIndex,
  isParked,
  keepsEntryQueued,
  newPendingEntry,
  parkedBy,
  pendingResult,
  provisionalSessionId,
  rejectsTheSit,
  requestWithClientId,
  syncedResult,
  thoughtsNotSent,
} from "./queueEntryLogic";
import { holdRowOpen, rowsHeldOpen, withQueueMutation } from "./queueLock";
import type { OfflineSessionQueueStore } from "./queueStore";
import {
  alwaysFailingSessionSyncTransport,
  isPermanentFailure,
  liveSessionSyncTransport,
  type SessionSyncTransport,
} from "./transport";
import type {
  CreateSessionPayload,
  PendingSessionEntry,
  PendingSessionThought,
  SavedSessionResult,
} from "./types";

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
      const entries = await this.loadEntriesForWrite();
      const existing = entries.find((entry) => entry.clientSessionId === clientSessionId);

      if (existing) {
        if (existing.ownerUserId !== ownerUserId) {
          throw new SessionSyncError("ownerMismatch");
        }
        if (!awaitsSync(existing) && existing.serverSessionId) {
          return syncedResult(existing.serverSessionId);
        }
      } else {
        entries.push(newPendingEntry(request, clientSessionId, ownerUserId, thoughts));
        await this.saveEntriesForWrite(entries);
        await requestBackgroundSync();
      }

      const synced = await this.flushEntry(clientSessionId, ownerUserId);
      return synced ? syncedResult(synced.serverSessionId!) : pendingResult(clientSessionId);
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

  /**
   * #947: marks a sit's row as still in use by an open completion screen, whose
   * note edits find a pending sit by its row. While held, in this tab or any
   * other, the return-home prune keeps the row. Call the returned function once
   * the screen's writes have settled; calling it again does nothing.
   */
  holdRowOpen(clientSessionId: string): () => void {
    return holdRowOpen(clientSessionId);
  }

  async resolvedServerSessionId(clientSessionId: string, ownerUserId: string): Promise<string | null> {
    const entry = findOwnedEntry(await this.queueStore.loadEntries(), clientSessionId, ownerUserId);
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

  /** #703: a store that cannot even be read is a store nothing was written
   *  to. Tagged like the write below so the caller classifies it as
   *  notStored — an untagged throw from here would be read as a *post-write*
   *  sync failure and reported as safely queued, which is the exact false
   *  reassurance this ticket is about. */
  private async loadEntriesForWrite(): Promise<PendingSessionEntry[]> {
    try {
      return await this.queueStore.loadEntries();
    } catch (error) {
      throw new LocalSessionWriteError("queueReadFailed", { cause: error });
    }
  }

  /** #703: the sit never reached the device. Tagged so the caller can tell
   *  this apart from a queued-but-unsent sit and say so to the user. */
  private async saveEntriesForWrite(entries: PendingSessionEntry[]): Promise<void> {
    try {
      await this.queueStore.saveEntries(entries);
    } catch (error) {
      throw new LocalSessionWriteError("queueWriteFailed", { cause: error });
    }
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
          // sit counts and `onSynced` still runs. A queue that cannot be read
          // here is a failure like any other: handed back once every sit has
          // had its turn, not thrown past the sits behind this one.
          if (!entry.sessionSynced) {
            try {
              if (await this.resolvedServerSessionId(entry.clientSessionId, ownerUserId)) syncedCount += 1;
            } catch (readError) {
              failure ??= { error: readError };
            }
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
      const entry = entries.find((item) => item.clientSessionId === clientSessionId);
      if (!entry) {
        throw new SessionSyncError("entryNotFound");
      }
      if (entry.ownerUserId !== ownerUserId) {
        throw new SessionSyncError("ownerMismatch");
      }

      applyEndNote(entry, note);
      await this.queueStore.saveEntries(entries);
      await requestBackgroundSync();
      await this.flushEntry(clientSessionId, ownerUserId);
    });
  }

  /** Uploads whatever the sit still owes: its session row, then its queued
   *  thoughts and any note clear. Resolves to the entry once its row exists on
   *  the server, or null while it stays queued. */
  private async flushEntry(
    clientSessionId: string,
    ownerUserId: string,
  ): Promise<PendingSessionEntry | null> {
    let entry = findOwnedEntry(await this.queueStore.loadEntries(), clientSessionId, ownerUserId);
    // #978: sent again, a parked sit would only get the same answer.
    if (!entry || isParked(entry)) return null;

    if (!entry.sessionSynced) {
      const created = await this.uploadSessionRow(entry);
      if (!created) return null;
      entry = created;
    }

    const serverSessionId = entry.serverSessionId;
    if (!serverSessionId) return null;

    entry = findOwnedEntry(await this.queueStore.loadEntries(), clientSessionId, ownerUserId) ?? entry;

    if (entry.thoughts.length > 0 || entry.clearCompletionNote === true) {
      return this.uploadThoughts(entry, serverSessionId);
    }
    return entry;
  }

  /** Creates the sit's server row and records its id. Null while the sit stays
   *  queued, or when its entry is gone by the time the row exists. */
  private async uploadSessionRow(entry: PendingSessionEntry): Promise<PendingSessionEntry | null> {
    try {
      const session = await this.transport.createSession(entry.request);
      const entries = await this.queueStore.loadEntries();
      const index = findOwnedEntryIndex(entries, entry.clientSessionId, entry.ownerUserId);
      if (index < 0) return null;
      entries[index]!.serverSessionId = session.id;
      entries[index]!.sessionSynced = true;
      await this.queueStore.saveEntries(entries);
      return entries[index]!;
    } catch (error) {
      return this.uploadFailed(error, entry);
    }
  }

  /** Sends the sit's queued thoughts (and a note clear, if asked for), then
   *  drops from the queue only what that batch delivered. */
  private async uploadThoughts(
    entry: PendingSessionEntry,
    serverSessionId: string,
  ): Promise<PendingSessionEntry | null> {
    const sentClear = entry.clearCompletionNote === true;
    const sent = entry.thoughts;
    try {
      await this.transport.batchThoughts({
        sessionId: serverSessionId,
        dayNumber: entry.request.dayNumber,
        thoughts: sent,
        ...(sentClear ? { clearCompletionNote: true as const } : {}),
      });
      const entries = await this.queueStore.loadEntries();
      const index = findOwnedEntryIndex(entries, entry.clientSessionId, entry.ownerUserId);
      if (index < 0) return entry;
      const current = entries[index]!;
      // Only drop what this batch sent. A note replaced while the request was
      // in flight (#753 autosave) stays queued for the next flush, and a clear
      // asked for after a request that carried none stays set (#792).
      const remaining = thoughtsNotSent(current.thoughts, sent);
      const clearDelivered = sentClear && current.clearCompletionNote === true;
      if (remaining.length === current.thoughts.length && !clearDelivered) return current;
      current.thoughts = remaining;
      if (clearDelivered) current.clearCompletionNote = false;
      await this.queueStore.saveEntries(entries);
      return current;
    } catch (error) {
      return this.uploadFailed(error, entry);
    }
  }

  /**
   * How an upload ends after it fails. A network failure or a retryable answer
   * leaves the entry queued for the next flush. So does a queue read or write
   * that fails just after an upload went through: the next flush sends it
   * again, as after a lost response (#557, #948). A permanent answer is
   * rethrown to the caller. #978: unless it is a 401 or 403, the entry is
   * parked first.
   */
  private async uploadFailed(error: unknown, entry: PendingSessionEntry): Promise<null> {
    if (keepsEntryQueued(error)) return null;
    if (rejectsTheSit(error)) await this.park(entry.clientSessionId, entry.ownerUserId, error);
    throw error;
  }

  /** #978: keeps the sit, with the answer that turned it down, where no flush
   *  sends it again. Runs in the caller's queue turn, like the rest of
   *  `flushEntry`. */
  private async park(clientSessionId: string, ownerUserId: string, error: unknown): Promise<void> {
    const entries = await this.queueStore.loadEntries();
    const entry = findOwnedEntry(entries, clientSessionId, ownerUserId);
    if (!entry) return;
    entry.parked = parkedBy(error);
    await this.queueStore.saveEntries(entries);
  }
}

let sharedCoordinator: WebSessionSyncCoordinator | null = null;

export function getWebSessionSyncCoordinator(): WebSessionSyncCoordinator {
  if (!sharedCoordinator) {
    sharedCoordinator = new WebSessionSyncCoordinator();
  }
  return sharedCoordinator;
}

export {
  LocalSessionWriteError,
  SessionSyncError,
  alwaysFailingSessionSyncTransport,
  provisionalSessionId,
  requestBackgroundSync,
  requestWithClientId,
};
