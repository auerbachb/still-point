"use client";

import { useSyncExternalStore } from "react";
import {
  loadTrackingControlPrefs,
  subscribeTrackingControlPrefs,
} from "./trackingControlPrefs";

export function useHideDistractionHyperfocusControlsPref(): boolean {
  return useSyncExternalStore(
    subscribeTrackingControlPrefs,
    () => loadTrackingControlPrefs().hideDistractionHyperfocusControls,
    () => false,
  );
}

export function useTrackingControlsUnlocked(): boolean {
  return useSyncExternalStore(
    subscribeTrackingControlPrefs,
    () => loadTrackingControlPrefs().trackingControlsUnlocked,
    () => false,
  );
}
