/** IndexedDB, Background Sync (#558) and Web Lock (#834) identifiers. Keep in sync with `public/sw.js`. */
export const OFFLINE_IDB_NAME = "stillpoint-offline-v1";
export const OFFLINE_IDB_STORE = "session-queue";
export const OFFLINE_SYNC_TAG = "stillpoint-session-sync";
/** Held by every queue write, in every tab and in the service worker. */
export const OFFLINE_QUEUE_LOCK_NAME = "stillpoint-session-queue";
