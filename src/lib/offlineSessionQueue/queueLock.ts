import { OFFLINE_OPEN_ROW_LOCK_PREFIX, OFFLINE_QUEUE_LOCK_NAME } from "./constants";

let queueMutation: Promise<unknown> = Promise.resolve();
/** #947: this tab's open completion screens, by sit, with a count per sit.
 *  Covers the tab itself where Web Locks is missing. */
const openRowsInTab = new Map<string, number>();

/**
 * Runs queue writes one at a time, in call order.
 *
 * #834: the queue lives in IndexedDB, which every tab and the service worker
 * share, so where the browser has Web Locks the turn is an exclusive lock they
 * all take. The in-memory chain orders only this tab's writes; it is the
 * fallback where Web Locks is missing (outside a secure context, in older
 * browsers, in tests).
 */
export async function withQueueMutation<T>(fn: () => Promise<T>): Promise<T> {
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

/**
 * #947: marks a sit's row as still in use by an open completion screen: counted
 * in this tab, and held as a shared Web Lock other tabs can see. Calling the
 * returned function releases it; calling it again does nothing.
 */
export function holdRowOpen(clientSessionId: string): () => void {
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

/** #947: the sits whose rows an open completion screen still needs: this tab's,
 *  plus every lock any tab holds or has asked for. Null when the other tabs'
 *  locks could not be read, so nothing is known safe to drop. */
export async function rowsHeldOpen(): Promise<Set<string> | null> {
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
