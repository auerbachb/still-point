"use client";

import { useSyncExternalStore } from "react";

/**
 * #666 — whether the browser currently believes it has a connection.
 *
 * Used to trigger the reconnect refresh, not to decide what to render: the
 * offline indicator follows "am I running from the cached identity?" (which
 * only a successful `me()` clears), exactly as iOS's `isOfflineMode` does.
 * `navigator.onLine` is a hint — it reports link state, not reachability — so
 * it is allowed to *prompt* a re-check and never to conclude one.
 */

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

/** Server renders assume a connection, so hydration never flashes an offline UI. */
function getServerSnapshot() {
  return true;
}

export function useOnlineStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
