import { OFFLINE_IDB_NAME, OFFLINE_IDB_STORE } from "./constants";
import { InMemoryOfflineSessionQueueStore, type OfflineSessionQueueStore } from "./queueStore";
import type { PendingSessionEntry } from "./types";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_IDB_STORE)) {
        db.createObjectStore(OFFLINE_IDB_STORE, { keyPath: "clientSessionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const closeDb = () => {
          try {
            db.close();
          } catch {
            // ignore close failures
          }
        };
        const tx = db.transaction(OFFLINE_IDB_STORE, mode);
        const store = tx.objectStore(OFFLINE_IDB_STORE);
        const request = fn(store);
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => {
          closeDb();
          reject(request.error ?? new Error("IndexedDB request failed"));
        };
        tx.oncomplete = () => closeDb();
        tx.onerror = () => {
          closeDb();
          reject(tx.error ?? new Error("IndexedDB transaction failed"));
        };
      }),
  );
}

export class IndexedDbOfflineSessionQueueStore implements OfflineSessionQueueStore {
  async loadEntries(): Promise<PendingSessionEntry[]> {
    if (typeof indexedDB === "undefined") {
      return [];
    }
    try {
      return await runTransaction("readonly", (store) => store.getAll());
    } catch {
      return [];
    }
  }

  async saveEntries(entries: PendingSessionEntry[]): Promise<void> {
    if (typeof indexedDB === "undefined") {
      return;
    }
    await openDb().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const closeDb = () => {
            try {
              db.close();
            } catch {
              // ignore close failures
            }
          };
          const tx = db.transaction(OFFLINE_IDB_STORE, "readwrite");
          const store = tx.objectStore(OFFLINE_IDB_STORE);
          const clearRequest = store.clear();
          clearRequest.onerror = () => {
            closeDb();
            reject(clearRequest.error ?? new Error("IndexedDB clear failed"));
          };
          clearRequest.onsuccess = () => {
            for (const entry of entries) {
              store.put(entry);
            }
          };
          tx.oncomplete = () => {
            closeDb();
            resolve();
          };
          tx.onerror = () => {
            closeDb();
            reject(tx.error ?? new Error("IndexedDB transaction failed"));
          };
        }),
    );
  }
}

export function defaultOfflineSessionQueueStore(): OfflineSessionQueueStore {
  if (typeof indexedDB !== "undefined") {
    return new IndexedDbOfflineSessionQueueStore();
  }
  return new InMemoryOfflineSessionQueueStore();
}
