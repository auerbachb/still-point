"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  broadcastSessionSuppression,
  loadSuppressDuringSessionPref,
  saveSuppressDuringSessionPref,
  subscribeSuppressDuringSessionPref,
  suppressDuringSessionPrefVersion,
  SUPPRESS_DURING_SESSION_DEFAULT,
  SUPPRESS_HEARTBEAT_MS,
} from "@/lib/sessionSuppressionPrefs";
import { fetchNotificationPreferences, reportSessionActiveState } from "@/lib/web-push-client";

/**
 * Live view of the `suppressDuringSession` preference (mirrored from the server
 * row into localStorage; on by default since #709). Re-renders when the Settings
 * toggle saves (same tab) or another tab writes the pref (`storage` event), so an
 * already-active session updates its relay on toggle-off.
 */
export function useSuppressDuringSessionPref(): boolean {
  return useSyncExternalStore(
    subscribeSuppressDuringSessionPref,
    () => loadSuppressDuringSessionPref(),
    () => SUPPRESS_DURING_SESSION_DEFAULT,
  );
}

/**
 * Holds Still Point's own notifications while a sit is in progress, on two layers:
 *
 * 1. **Server (#709):** reports `active` to `/api/notifications/session-state` so
 *    the push is never sent — the only layer that can cover a push arriving during
 *    a service-worker cold start. Refreshed on the heartbeat because the server
 *    signal carries a TTL, and cleared on cleanup/unmount.
 * 2. **Service worker (#431):** relays `suppress = prefOn && sessionActive` over a
 *    `BroadcastChannel` so anything already in flight is not displayed.
 *
 * Both are released when the sit ends, so a push arriving afterwards is shown
 * normally. Web parity with the iOS `willPresent` suppression in
 * `PushNotificationCoordinator`.
 */
export function useSessionSuppressionRelay(sessionActive: boolean): void {
  const prefOn = useSuppressDuringSessionPref();
  const suppress = prefOn && sessionActive;
  // Tracks whether this hook told the server a sit is running, so mounting a
  // session view with the pref off does not fire a pointless "clear" request.
  const reportedActiveRef = useRef(false);

  // Refresh the localStorage mirror from the server when a sit starts so
  // suppression honors the server-synced pref even in a browser that never
  // opened Notification settings (and picks up cross-device toggles). The
  // mirror update re-renders this hook via useSyncExternalStore.
  useEffect(() => {
    if (!sessionActive) return;
    let cancelled = false;
    const versionAtRequest = suppressDuringSessionPrefVersion();
    void (async () => {
      try {
        const prefs = await fetchNotificationPreferences();
        if (cancelled) return;
        // The response describes the server row as it stood when the request
        // left. A toggle — or an auth-boundary clear — that landed since is
        // newer, so writing the response back would revive the value the user
        // just replaced: toggling "During sessions" off mid-sit would silently
        // re-suppress and re-report the sit as active. The local write wins, and
        // the PATCH behind it leaves the next sit's fetch agreeing anyway.
        if (suppressDuringSessionPrefVersion() !== versionAtRequest) return;
        saveSuppressDuringSessionPref(prefs.suppressDuringSession);
      } catch {
        // Best-effort: keep the mirrored/default value on failure.
      }
    })();
    return () => { cancelled = true; };
  }, [sessionActive]);

  useEffect(() => {
    broadcastSessionSuppression(suppress);

    if (!suppress) {
      // Covers pref toggled off mid-sit: React runs the cleanup below first, so
      // this only fires when nothing was reported (and is then a no-op).
      if (reportedActiveRef.current) {
        reportedActiveRef.current = false;
        void reportSessionActiveState(false);
      }
      return;
    }

    reportedActiveRef.current = true;
    void reportSessionActiveState(true);

    const heartbeat = setInterval(() => {
      broadcastSessionSuppression(true);
      void reportSessionActiveState(true);
    }, SUPPRESS_HEARTBEAT_MS);

    return () => {
      clearInterval(heartbeat);
      // Releasing on unmount avoids a stale "suppress" outliving the sit (e.g.
      // navigating away mid-session without a clean complete/abandon).
      broadcastSessionSuppression(false);
      reportedActiveRef.current = false;
      void reportSessionActiveState(false);
    };
  }, [suppress]);
}
