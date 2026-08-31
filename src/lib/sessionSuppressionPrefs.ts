/**
 * Client mirror of the server-synced `suppressDuringSession` notification
 * preference (#431), plus the page→Service Worker relay used to suppress push
 * display while a sit is in progress.
 *
 * The server row is canonical (synced across devices). `WebNotificationSettings`
 * mirrors the latest value into localStorage on load/patch so an in-progress
 * `SessionView` can read it synchronously without a network round-trip — the
 * same offline-friendly pattern used by `wakeLockPrefs` (#317).
 */

const STORAGE_KEY = "stillpoint_suppress_during_session";

/**
 * BroadcastChannel name shared with `public/sw.js`. The page posts the desired
 * suppression state here; the service worker listens and skips
 * `showNotification` while suppression is active. Keep this string in sync with
 * `SW_SUPPRESSION_CHANNEL` in `public/sw.js`.
 */
export const SESSION_SUPPRESSION_CHANNEL = "stillpoint-session-suppression";

/**
 * How often the page re-broadcasts an active "suppress" so the service worker's
 * persisted state never expires mid-sit. Must be shorter than `SUPPRESS_TTL_MS`
 * in `public/sw.js` (10 min) so a long sit stays covered while a killed tab
 * still self-heals within the TTL.
 */
export const SUPPRESS_HEARTBEAT_MS = 60 * 1000;

/** Message posted page→service worker over {@link SESSION_SUPPRESSION_CHANNEL}. */
export type SessionSuppressionMessage = {
  type: "session-suppression-state";
  /** True while push display should be suppressed (pref on AND a sit is active). */
  suppress: boolean;
};

/**
 * Silencing Still Point's notifications during a sit is on unless the user turned
 * it off (#709). A browser that has never loaded the Notification settings screen
 * has no mirrored value, and must still start a sit silent — the server row is
 * fetched right after and corrects an opted-out user.
 */
export const SUPPRESS_DURING_SESSION_DEFAULT = true;

export function loadSuppressDuringSessionPref(): boolean {
  if (typeof window === "undefined") return SUPPRESS_DURING_SESSION_DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return SUPPRESS_DURING_SESSION_DEFAULT;
    return raw !== "false";
  } catch {
    return SUPPRESS_DURING_SESSION_DEFAULT;
  }
}

export function saveSuppressDuringSessionPref(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Best-effort persistence: ignore storage write failures.
  }
  notifyListeners();
}

type Listener = () => void;

const listeners = new Set<Listener>();

function onStorageEvent(e: StorageEvent): void {
  // key === null means the whole storage area was cleared.
  if (e.key === STORAGE_KEY || e.key === null) notifyListeners();
}

function notifyListeners(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Subscribe to preference changes: same-tab saves via
 * `saveSuppressDuringSessionPref` and cross-tab writes via the `storage` event.
 * Returns an unsubscribe function (`useSyncExternalStore`-compatible).
 */
export function subscribeSuppressDuringSessionPref(listener: Listener): () => void {
  if (typeof window !== "undefined" && listeners.size === 0) {
    window.addEventListener("storage", onStorageEvent);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined" && listeners.size === 0) {
      window.removeEventListener("storage", onStorageEvent);
    }
  };
}

/**
 * Relay the desired suppression state to the service worker. Best-effort: no-op
 * when `BroadcastChannel` is unavailable (the service worker simply keeps its
 * last known state, which defaults to "do not suppress").
 */
export function broadcastSessionSuppression(suppress: boolean): void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(SESSION_SUPPRESSION_CHANNEL);
    const message: SessionSuppressionMessage = { type: "session-suppression-state", suppress };
    channel.postMessage(message);
  } catch {
    // Ignore: relay is best-effort.
  } finally {
    channel?.close();
  }
}
