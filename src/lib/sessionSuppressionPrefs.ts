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

/**
 * Drop the mirror at an auth boundary (#709).
 *
 * The key is global to the browser, not scoped to an account, so one user's
 * stored `false` would otherwise be read as the *next* user's preference. That
 * is not a cosmetic staleness: `useSessionSuppressionRelay` gates the server
 * "a sit is running" report on this value, so an inherited `false` means the
 * next account never reports its sit and takes banners straight through the
 * middle of it — the exact complaint in #709, one account removed.
 *
 * Removing the key rather than writing `true` lets the read fall back to
 * {@link SUPPRESS_DURING_SESSION_DEFAULT} (silent by default), and the sit-start
 * fetch in `useSessionSuppressionRelay` then fills in the real server value.
 */
export function clearSuppressDuringSessionPref(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort: a storage failure leaves the default in force, which is silent.
  }
  notifyListeners();
}

type Listener = () => void;

const listeners = new Set<Listener>();

function onStorageEvent(e: StorageEvent): void {
  // key === null means the whole storage area was cleared.
  if (e.key === STORAGE_KEY || e.key === null) notifyListeners();
}

let prefVersion = 0;

/**
 * Monotonic counter bumped on every mirror change — same-tab
 * {@link saveSuppressDuringSessionPref} / {@link clearSuppressDuringSessionPref}
 * and cross-tab `storage` events alike.
 *
 * `useSessionSuppressionRelay` samples it either side of the sit-start
 * preference fetch so a response that left the server *before* a newer local
 * write cannot overwrite it. Comparing the stored value instead would miss two
 * cases: a cleared mirror and an explicit `true` both read as
 * {@link SUPPRESS_DURING_SESSION_DEFAULT}, and a toggle that lands twice in one
 * flight ends where it started.
 */
export function suppressDuringSessionPrefVersion(): number {
  return prefVersion;
}

function notifyListeners(): void {
  prefVersion += 1;
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
