"use client";

import { useSyncExternalStore } from "react";
import {
  MINIMAL_SESSION_VIEW_DEFAULT,
  loadMinimalSessionViewPref,
  subscribeMinimalSessionViewPref,
} from "@/lib/minimalSessionViewPrefs";

/**
 * Live view of the persisted "just the timer" preference (#669).
 *
 * The stored preference is the single source of truth for the running sit, so
 * toggling minimal view both updates the screen and is remembered for the next
 * sit. The server snapshot is the default (full screen) so SSR markup matches
 * the first client render before localStorage is read.
 */
export function useMinimalSessionViewPref(): boolean {
  return useSyncExternalStore(
    subscribeMinimalSessionViewPref,
    loadMinimalSessionViewPref,
    () => MINIMAL_SESSION_VIEW_DEFAULT,
  );
}
