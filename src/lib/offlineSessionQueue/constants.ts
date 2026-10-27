/**
 * The offline session queue's fixed names and limits.
 *
 * `public/sw.js` is a plain script that cannot import this module, so it keeps
 * its own copy of every constant in the first group. `sw.constants.test.ts`
 * runs the worker and fails when a copy is missing or differs, or when a new
 * export here is in neither group. Each constant documents itself; this header
 * names none, so adding one changes only its own group.
 */

// --- Shared with `public/sw.js` -------------------------------------------

/** #558: the IndexedDB database that holds the queue. */
export const OFFLINE_IDB_NAME = "stillpoint-offline-v1";
/** #558: the queue's object store in that database. */
export const OFFLINE_IDB_STORE = "session-queue";
/** #558: the Background Sync tag that wakes the worker to flush the queue. */
export const OFFLINE_SYNC_TAG = "stillpoint-session-sync";
/** #834: held by every queue write, in every tab and in the service worker. */
export const OFFLINE_QUEUE_LOCK_NAME = "stillpoint-session-queue";
/**
 * #907: how long one upload may take, response body included, before it is
 * aborted and left queued for the next flush. Uploads run inside the queue
 * lock, so this bounds how long a stalled one keeps every other queue write
 * waiting.
 *
 * Sized for the slowest upload a user can reasonably make, a long thoughts batch
 * on a weak connection, so that a slow upload that would succeed is not cut off
 * and retried forever. A heavy batch is tens of KB: even 100 KB over a
 * 20–50 kbit/s uplink is 16–40 s on the wire, plus connection setup and a cold
 * server start.
 */
export const UPLOAD_TIMEOUT_MS = 60_000;
/**
 * #978: how much of the answer that parked a queued sit is kept with it. The
 * routes answer with a short JSON error; this bounds what a page from in front
 * of them (a proxy, the platform) can put in the queue.
 */
export const PARKED_MESSAGE_MAX_LENGTH = 200;

// --- Tabs only: the service worker never uses these -----------------------

/** #947: prefix of the shared Web Lock a tab holds, per sit, while its
 *  completion screen still writes that sit's notes through the queue. The
 *  return-home prune skips a row whose lock any tab holds. The service worker
 *  never prunes. */
export const OFFLINE_OPEN_ROW_LOCK_PREFIX = "stillpoint-open-completion:";
