"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  DEFAULT_KEEP_SCREEN_AWAKE,
  isWakeLockSupported,
  loadWakeLockPrefs,
  subscribeWakeLockPrefs,
} from "@/lib/wakeLockPrefs";

/** Inert during SSR (no session is running), but must not drift from the pref default. */
const getServerSnapshot = (): boolean => DEFAULT_KEEP_SCREEN_AWAKE;

/**
 * Live view of the opt-out "keep screen awake" preference (#730: on unless the
 * user turned it off). Re-renders when the Settings toggle saves (same tab) or
 * another tab writes the pref (`storage` event), so an already-mounted session
 * releases its lock on toggle-off.
 */
export function useKeepScreenAwakePref(): boolean {
  return useSyncExternalStore(
    subscribeWakeLockPrefs,
    () => loadWakeLockPrefs().keepScreenAwakeDuringSession,
    getServerSnapshot,
  );
}

/**
 * Holds a Screen Wake Lock (`navigator.wakeLock.request("screen")`) while
 * `enabled` is true — web parity with iOS `SessionIdleTimerController` (#317).
 *
 * Callers pass a single boolean derived from existing session state (e.g.
 * `prefOn && isActive`); all acquire/release/re-acquire complexity lives here:
 * - Acquires when `enabled` flips true (and the document is visible).
 * - Releases when `enabled` flips false (pause, complete, abandon, toggle-off)
 *   or on unmount (navigation away).
 * - Browsers auto-release the lock when the page is hidden; a `visibilitychange`
 *   listener re-acquires it when the page becomes visible again.
 * - No-ops when the Wake Lock API is unsupported.
 */
export function useWakeLock(enabled: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled || !isWakeLockSupported()) return;

    let cancelled = false;
    // Serializes overlapping acquire() calls (e.g. mount + a quick
    // visibilitychange): without this, a slow request resolving late could
    // overwrite or orphan an already-stored sentinel.
    let acquireInFlight = false;

    const acquire = async () => {
      if (cancelled || acquireInFlight || document.visibilityState !== "visible") return;
      if (sentinelRef.current && !sentinelRef.current.released) return;
      acquireInFlight = true;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled || (sentinelRef.current && !sentinelRef.current.released)) {
          // Effect torn down (or another sentinel won) while the request was
          // in flight — release immediately so no lock is orphaned.
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Best-effort: the browser can refuse (e.g. battery saver). The sit
        // continues without a wake lock — the same outcome as an explicit opt-out.
      } finally {
        acquireInFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel && !sentinel.released) {
        void sentinel.release().catch(() => {});
      }
    };
  }, [enabled]);
}
