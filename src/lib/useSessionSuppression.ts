"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  broadcastSessionSuppression,
  loadSuppressDuringSessionPref,
  subscribeSuppressDuringSessionPref,
  SUPPRESS_HEARTBEAT_MS,
} from "@/lib/sessionSuppressionPrefs";

/**
 * Live view of the opt-in `suppressDuringSession` preference (mirrored from the
 * server row into localStorage). Re-renders when the Settings toggle saves
 * (same tab) or another tab writes the pref (`storage` event), so an
 * already-active session updates its relay on toggle-off.
 */
export function useSuppressDuringSessionPref(): boolean {
  return useSyncExternalStore(
    subscribeSuppressDuringSessionPref,
    () => loadSuppressDuringSessionPref(),
    () => false,
  );
}

/**
 * Relays session-suppression state to the service worker over a
 * `BroadcastChannel` (#431). Posts `suppress = prefOn && sessionActive` whenever
 * either input changes, and always posts `suppress: false` on unmount so a push
 * arriving after the sit ends is shown normally.
 *
 * While suppressing it re-broadcasts on a heartbeat so the worker's persisted
 * state (which carries a TTL) never lapses mid-sit, while a hard tab kill still
 * self-heals once the TTL passes.
 *
 * Web parity with the iOS `willPresent` suppression in `PushNotificationCoordinator`.
 */
export function useSessionSuppressionRelay(sessionActive: boolean): void {
  const prefOn = useSuppressDuringSessionPref();
  const suppress = prefOn && sessionActive;

  useEffect(() => {
    broadcastSessionSuppression(suppress);
    if (!suppress) return;
    const heartbeat = setInterval(() => broadcastSessionSuppression(true), SUPPRESS_HEARTBEAT_MS);
    return () => {
      clearInterval(heartbeat);
      // Releasing on unmount avoids a stale "suppress" outliving the sit (e.g.
      // navigating away mid-session without a clean complete/abandon).
      broadcastSessionSuppression(false);
    };
  }, [suppress]);
}
