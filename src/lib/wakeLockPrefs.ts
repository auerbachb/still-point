export type WakeLockPrefs = {
  /** Opt-out (default on): keep the screen awake while a sit timer is running (parity with iOS #306). */
  keepScreenAwakeDuringSession: boolean;
};

const STORAGE_KEY = "stillpoint_wake_lock_prefs";

/**
 * Resolved value for a user who has never touched the setting.
 *
 * #730 flipped this from opt-in to opt-out: #660 was filed because a sit's
 * screen dimmed under the old default. An explicit choice is never overridden —
 * presence of `STORAGE_KEY` is what distinguishes "never set" from a stored
 * `false`, so no migration is involved and an opt-out survives forever.
 * iOS mirrors this in `StillPointShared/WakeLockPrefs.swift`.
 */
export const DEFAULT_KEEP_SCREEN_AWAKE = true;

const DEFAULTS: WakeLockPrefs = {
  keepScreenAwakeDuringSession: DEFAULT_KEEP_SCREEN_AWAKE,
};

/** True when the browser exposes the Screen Wake Lock API (secure contexts only). */
export function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export function loadWakeLockPrefs(): WakeLockPrefs {
  if (typeof window === "undefined") return DEFAULTS;

  try {
    // No key at all: the user has never touched the setting, so the #730
    // default applies. A stored boolean — `false` included — always wins.
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
    const value = (parsed as Record<string, unknown>).keepScreenAwakeDuringSession;
    return typeof value === "boolean" ? { keepScreenAwakeDuringSession: value } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveWakeLockPrefs(prefs: WakeLockPrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort persistence: ignore storage write failures.
  }
  notifyWakeLockPrefsListeners();
}

type WakeLockPrefsListener = () => void;

const listeners = new Set<WakeLockPrefsListener>();

function onStorageEvent(e: StorageEvent): void {
  // key === null means the whole storage area was cleared.
  if (e.key === STORAGE_KEY || e.key === null) notifyWakeLockPrefsListeners();
}

function notifyWakeLockPrefsListeners(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Subscribe to wake-lock preference changes: same-tab saves via
 * `saveWakeLockPrefs` and cross-tab changes via the `storage` event.
 * Returns an unsubscribe function (`useSyncExternalStore`-compatible).
 */
export function subscribeWakeLockPrefs(listener: WakeLockPrefsListener): () => void {
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
