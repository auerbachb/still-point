"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionCues } from "@/lib/useSessionCues";

/** Server timestamps for a buddy sit, refreshed by each poll. */
export type SyncClock = {
  startedAt: string;
  serverNow: string;
  durationSeconds: number;
};

type UseElapsedClockOptions = {
  totalSeconds: number;
  isActive: boolean;
  /** Parent-driven elapsed; ignored while a buddy `syncClock` is set. */
  controlledElapsed?: number;
  /** Buddy / server-synced clock; takes precedence over `controlledElapsed`. */
  syncClock?: SyncClock;
  onComplete: () => void;
  onElapsedChange?: (elapsed: number) => void;
  cues: SessionCues;
};

/**
 * #732: the seconds elapsed in a sit, from whichever of three clocks drives it:
 *
 * - **local** (solo sits) — a 50ms wall-clock interval that pauses and resumes
 *   with `isActive`;
 * - **buddy `syncClock`** — the same 50ms interval, measured against server
 *   timestamps from the polls so every participant shares one clock;
 * - **controlled** — the parent passes `controlledElapsed`, and this follows.
 *
 * Each tells `cues` where the sit is: re-seeding on a start, resume, or
 * restart, advancing on each update, and ending it exactly once. What plays,
 * and when, is decided there.
 */
export function useElapsedClock({
  totalSeconds,
  isActive,
  controlledElapsed,
  syncClock,
  onComplete,
  onElapsedChange,
  cues,
}: UseElapsedClockOptions): number {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pausedElapsedRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const controlledCompleteFiredRef = useRef(false);
  /** Previous controlled elapsed, so a restart can be told from normal advance. */
  const lastControlledElapsedRef = useRef(-1);
  const skewRef = useRef(0);
  const syncClockRef = useRef(syncClock);
  syncClockRef.current = syncClock;
  const isBuddySync = Boolean(syncClock?.startedAt && syncClock?.serverNow);
  const isControlled = controlledElapsed !== undefined && !isBuddySync;

  useEffect(() => {
    if (!syncClock?.startedAt || !syncClock?.serverNow) return;
    skewRef.current = new Date(syncClock.serverNow).getTime() - Date.now();
  }, [syncClock?.startedAt, syncClock?.serverNow]);

  useEffect(() => {
    if (isControlled || isBuddySync) return;

    // Reset or seed refs based on whether this is a fresh session or a resume
    const resumeElapsed = pausedElapsedRef.current;
    const isResume =
      resumeElapsed < totalSeconds &&
      (resumeElapsed > 0 || startTimeRef.current !== null);

    if (isResume) {
      cues.seed(resumeElapsed, totalSeconds);
    } else {
      // Fresh session — clear all accumulated state. That includes the start
      // time: left set, a finished sit restarted from here would read as a
      // resume from 0 and skip the tick at second 0 (#844).
      cues.reset();
      pausedElapsedRef.current = 0;
      startTimeRef.current = null;
      setElapsed(0);
    }

    if (isActive) {
      startTimeRef.current = Date.now() - pausedElapsedRef.current * 1000;
      intervalRef.current = setInterval(() => {
        const now = Date.now();
        const newElapsed = (now - startTimeRef.current!) / 1000;
        if (newElapsed >= totalSeconds) {
          setElapsed(totalSeconds);
          pausedElapsedRef.current = totalSeconds;
          clearInterval(intervalRef.current!);
          cues.end();
          onCompleteRef.current();
        } else {
          setElapsed(newElapsed);
          pausedElapsedRef.current = newElapsed;
          cues.advance(newElapsed, totalSeconds);
        }
      }, 50);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, totalSeconds, isControlled, isBuddySync]);

  useEffect(() => {
    if (!isBuddySync || !isActive || !syncClock?.startedAt || !syncClock?.serverNow) {
      return;
    }

    const duration = totalSeconds;
    const startedMs = new Date(syncClock.startedAt).getTime();
    skewRef.current = new Date(syncClock.serverNow).getTime() - Date.now();

    const seed = Math.min(duration, Math.max(0, (Date.now() + skewRef.current - startedMs) / 1000));
    cues.seed(seed, duration);
    controlledCompleteFiredRef.current = false;
    setElapsed(seed);
    pausedElapsedRef.current = seed;

    const id = window.setInterval(() => {
      const sc = syncClockRef.current;
      if (!sc?.startedAt) return;
      const startMs = new Date(sc.startedAt).getTime();
      const newElapsed = Math.min(
        duration,
        Math.max(0, (Date.now() + skewRef.current - startMs) / 1000),
      );

      if (newElapsed >= duration) {
        setElapsed(duration);
        pausedElapsedRef.current = duration;
        window.clearInterval(id);
        if (!controlledCompleteFiredRef.current) {
          controlledCompleteFiredRef.current = true;
          cues.end();
          onCompleteRef.current();
        }
        return;
      }

      setElapsed(newElapsed);
      pausedElapsedRef.current = newElapsed;
      cues.advance(newElapsed, duration);
    }, 50);

    return () => window.clearInterval(id);
  }, [isBuddySync, isActive, syncClock?.startedAt, totalSeconds]);

  useEffect(() => {
    if (!isControlled) return;
    const raw = controlledElapsed ?? 0;
    const newElapsed = Math.min(totalSeconds, Math.max(0, raw));

    if (newElapsed >= totalSeconds) {
      setElapsed(totalSeconds);
      pausedElapsedRef.current = totalSeconds;
      // Recorded before the early return so a run that lands on the end without
      // an intermediate update still leaves a high-water mark for the next run
      // to fall below.
      lastControlledElapsedRef.current = totalSeconds;
      if (!controlledCompleteFiredRef.current) {
        controlledCompleteFiredRef.current = true;
        cues.end();
        onCompleteRef.current();
      }
      return;
    }

    setElapsed(newElapsed);
    pausedElapsedRef.current = newElapsed;
    // Elapsed moving backwards means a fresh run on the same mounted timer.
    // Re-seed from the new position exactly as the buddy-sync path seeds on
    // start: the cue guards are all monotonic, so left at the finished run's
    // high-water mark they would swallow the new run's ticks, minute markers,
    // end haptic and completion cue until it passed the old total.
    if (newElapsed < lastControlledElapsedRef.current) {
      cues.rewind(newElapsed, totalSeconds);
      controlledCompleteFiredRef.current = false;
    }
    lastControlledElapsedRef.current = newElapsed;
    cues.advanceControlled(newElapsed, totalSeconds);
  }, [isControlled, controlledElapsed, totalSeconds]);

  useEffect(() => {
    onElapsedChange?.(elapsed);
  }, [elapsed, onElapsedChange]);

  return elapsed;
}
