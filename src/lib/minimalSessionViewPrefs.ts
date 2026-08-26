/**
 * #669: "just the timer" minimal session view.
 *
 * Persists whether the session screen collapses to the numeric countdown alone.
 * Mirrors `trackingControlPrefs.ts`: one boolean localStorage key plus a listener
 * set so an already-mounted session re-renders when the value changes — same tab
 * via `saveMinimalSessionViewPref`, other tabs via the `storage` event.
 *
 * iOS persists the same preference in `UserDefaults` under
 * `IOS_MINIMAL_SESSION_VIEW_KEY` (`MinimalSessionViewPrefs.swift`) so both
 * clients use identical key naming.
 */

/** Web localStorage key. */
export const MINIMAL_SESSION_VIEW_STORAGE_KEY = "stillpoint_minimal_session_view";

/** iOS UserDefaults key (parity with web localStorage). */
export const IOS_MINIMAL_SESSION_VIEW_KEY = "sp_minimalSessionView";

/** Sits show the full session screen unless the user opts into the minimal view. */
export const MINIMAL_SESSION_VIEW_DEFAULT = false;

/**
 * The last value we tried to persist while `localStorage` refused the write
 * (Safari private browsing, quota exceeded); `null` means storage is
 * authoritative. Without it a refused write would leave the loader returning the
 * stale stored value, so `useSyncExternalStore` would re-read the old boolean
 * and the tap that toggled minimal view would look like it did nothing.
 */
let unpersistedPref: boolean | null = null;

export function loadMinimalSessionViewPref(): boolean {
  if (typeof window === "undefined") return MINIMAL_SESSION_VIEW_DEFAULT;
  // A choice storage refused wins until storage accepts a write again, so the
  // running sit follows the user even when persistence is unavailable.
  if (unpersistedPref !== null) return unpersistedPref;
  try {
    const raw = localStorage.getItem(MINIMAL_SESSION_VIEW_STORAGE_KEY);
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return MINIMAL_SESSION_VIEW_DEFAULT;
  } catch {
    return MINIMAL_SESSION_VIEW_DEFAULT;
  }
}

export function saveMinimalSessionViewPref(minimal: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MINIMAL_SESSION_VIEW_STORAGE_KEY, minimal ? "true" : "false");
    // Storage is authoritative again; drop any earlier refused write.
    unpersistedPref = null;
  } catch {
    // Storage refused the write (private browsing, quota exceeded). Hold the
    // choice in memory so the live sit still toggles; persistence resumes on the
    // next write storage accepts.
    unpersistedPref = minimal;
  }
  notifyMinimalSessionViewListeners();
}

/**
 * Drops the in-memory value recorded when a `localStorage` write was refused, so
 * the next read comes from storage again. Exported for tests, which swap the
 * storage stub between cases.
 */
export function resetMinimalSessionViewPrefFallback(): void {
  unpersistedPref = null;
}

type MinimalSessionViewListener = () => void;

const listeners = new Set<MinimalSessionViewListener>();

function onStorageEvent(e: StorageEvent): void {
  // `storage` also fires for sessionStorage. Ignoring those matters most for the
  // clear-all case below, which would otherwise drop a refused write's in-memory
  // value and silently revert the sit. Real events always name their area;
  // synthetic ones (tests, older engines) may not, so only a mismatch is ignored.
  if (e.storageArea && e.storageArea !== window.localStorage) return;
  // key === null means the whole storage area was cleared.
  if (e.key === MINIMAL_SESSION_VIEW_STORAGE_KEY || e.key === null) {
    // Another tab reached storage, so storage is authoritative again.
    unpersistedPref = null;
    notifyMinimalSessionViewListeners();
  }
}

function notifyMinimalSessionViewListeners(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Subscribe to minimal-view preference changes. Returns an unsubscribe function
 * (`useSyncExternalStore`-compatible).
 */
export function subscribeMinimalSessionViewPref(listener: MinimalSessionViewListener): () => void {
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
