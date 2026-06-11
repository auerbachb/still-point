export type WakeLockPrefs = {
  /** Opt-in: keep the screen awake while a sit timer is running (parity with iOS #306). */
  keepScreenAwakeDuringSession: boolean;
};

const STORAGE_KEY = "stillpoint_wake_lock_prefs";

const DEFAULTS: WakeLockPrefs = {
  keepScreenAwakeDuringSession: false,
};

/** True when the browser exposes the Screen Wake Lock API (secure contexts only). */
export function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export function loadWakeLockPrefs(): WakeLockPrefs {
  if (typeof window === "undefined") return DEFAULTS;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
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
}
