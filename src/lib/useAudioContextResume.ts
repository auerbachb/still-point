"use client";

import { useEffect } from "react";
import { resumeAudioContext } from "@/lib/audio";

/**
 * Resumes a suspended `AudioContext` whenever the page becomes visible again,
 * for as long as `enabled` is true (#710).
 *
 * Browsers suspend the context when a tab is backgrounded or the screen locks.
 * Nothing resumed it, so a sit whose tick stopped part-way through stayed silent
 * to the end — the web half of the same failure the iOS audio engine had.
 *
 * Mirrors the recovery in `useWakeLock`: guard overlapping calls, use a cancelled
 * flag for teardown, remove the listener on unmount. Resuming an already-unlocked
 * context needs no user gesture, and `resumeAudioContext()` never creates one, so
 * this cannot strand a context in a permanently-suspended state.
 */
export function useAudioContextResume(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    let cancelled = false;
    // Serializes overlapping resumes: visibilitychange can fire again while an
    // earlier resume() is still in flight.
    let resumeInFlight = false;

    const resume = async () => {
      if (cancelled || resumeInFlight || document.visibilityState !== "visible") return;
      resumeInFlight = true;
      try {
        await resumeAudioContext();
      } finally {
        resumeInFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void resume();
    };

    // Covers a context suspended before this session mounted.
    void resume();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled]);
}
