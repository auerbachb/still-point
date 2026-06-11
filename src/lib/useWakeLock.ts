"use client";

import { useEffect, useRef } from "react";
import { isWakeLockSupported } from "@/lib/wakeLockPrefs";

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

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (sentinelRef.current && !sentinelRef.current.released) return;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Best-effort: the browser can refuse (e.g. battery saver). The sit
        // continues without a wake lock, matching iOS opt-in semantics.
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
