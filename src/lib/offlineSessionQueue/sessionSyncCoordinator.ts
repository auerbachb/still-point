import { OFFLINE_SYNC_TAG } from "./constants";
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

function requestWithClientId(
  request: Omit<CreateSessionPayload, "clientSessionId">,
  clientSessionId: string,
): CreateSessionPayload {
  return { ...request, clientSessionId };
}

function provisionalSessionId(clientSessionId: string): string {
  return clientSessionId;
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
      (entry) =>
        entry.ownerUserId === ownerUserId
        && (!entry.sessionSynced || entry.thoughts.length > 0),
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
      const entries = await this.queueStore.loadEntries();
      const existingIndex = entries.findIndex((entry) => entry.clientSessionId === clientSessionId);

      if (existingIndex >= 0) {
        const existing = entries[existingIndex]!;
        if (existing.ownerUserId !== ownerUserId) {
          throw new SessionSyncError("ownerMismatch");
        }
        if (existing.sessionSynced && existing.thoughts.length === 0 && existing.serverSessionId) {
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
        await this.queueStore.saveEntries(entries);
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

  async appendEndNote(clientSessionId: string, ownerUserId: string, note: string): Promise<void> {
    const trimmed = note.trim();
    if (!trimmed) return;
    if (!ownerUserId) {
      throw new SessionSyncError("missingOwnerUserId");
    }

    return withQueueMutation(async () => {
      const entries = await this.queueStore.loadEntries();
      const index = entries.findIndex((entry) => entry.clientSessionId === clientSessionId);
      if (index < 0) {
        throw new SessionSyncError("entryNotFound");
      }
      if (entries[index]!.ownerUserId !== ownerUserId) {
        throw new SessionSyncError("ownerMismatch");
      }

      entries[index]!.thoughts.push({ timeInSession: -1, text: trimmed });
      await this.queueStore.saveEntries(entries);
      await requestBackgroundSync();
      await this.flushEntry(clientSessionId, ownerUserId);
    });
  }

  async flushPending(ownerUserId: string): Promise<number> {
    if (!ownerUserId) return 0;

    const entries = await this.queueStore.loadEntries();
    let syncedCount = 0;
    for (const entry of entries) {
      if (entry.ownerUserId !== ownerUserId) continue;
      if (entry.sessionSynced && entry.thoughts.length === 0) continue;
      const flushed = await this.flushEntry(entry.clientSessionId, ownerUserId);
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
    const entries = await this.queueStore.loadEntries();
    const next = entries.filter(
      (entry) =>
        !(entry.ownerUserId === ownerUserId && entry.sessionSynced && entry.thoughts.length === 0),
    );
    if (next.length !== entries.length) {
      await this.queueStore.saveEntries(next);
    }
  }

  async clearQueue(): Promise<void> {
    await this.queueStore.saveEntries([]);
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

    if (entry.thoughts.length > 0) {
      try {
        await this.transport.batchThoughts({
          sessionId: serverSessionId,
          dayNumber: entry.request.dayNumber,
          thoughts: entry.thoughts,
        });
        const entries = await this.queueStore.loadEntries();
        const index = entries.findIndex(
          (item) => item.clientSessionId === clientSessionId && item.ownerUserId === ownerUserId,
        );
        if (index < 0) return entry;
        if (entries[index]!.thoughts.length === 0) return entry;
        entries[index]!.thoughts = [];
        await this.queueStore.saveEntries(entries);
        entry = entries[index]!;
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

async function withQueueMutation<T>(fn: () => Promise<T>): Promise<T> {
  const result = queueMutation.then(fn);
  queueMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
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
