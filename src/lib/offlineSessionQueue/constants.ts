/** IndexedDB, Background Sync (#558) and Web Lock (#834) identifiers, the
 *  upload deadline (#907) and the parked-answer length (#978). Keep in sync
 *  with `public/sw.js`. */
export const OFFLINE_IDB_NAME = "stillpoint-offline-v1";
export const OFFLINE_IDB_STORE = "session-queue";
export const OFFLINE_SYNC_TAG = "stillpoint-session-sync";
/** Held by every queue write, in every tab and in the service worker. */
export const OFFLINE_QUEUE_LOCK_NAME = "stillpoint-session-queue";
/** #947: prefix of the shared Web Lock a tab holds, per sit, while its
 *  completion screen still writes that sit's notes through the queue. The
 *  return-home prune skips a row whose lock any tab holds. Tabs only: the
 *  service worker never prunes. */
export const OFFLINE_OPEN_ROW_LOCK_PREFIX = "stillpoint-open-completion:";
/**
 * #907: how long one upload may take, response body included, before it is
 * aborted and left queued for the next flush. Uploads run inside the lock above,
 * so this bounds how long a stalled one keeps every other queue write waiting.
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
