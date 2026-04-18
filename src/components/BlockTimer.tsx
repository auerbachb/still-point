"use client";

import { useState, useEffect, useRef } from "react";
import { BLOCK_DURATION } from "@/lib/constants";
import { MindStateBar } from "./MindStateBar";
import { playTick, playChime, playCompletion, type SoundPrefs } from "@/lib/audio";
import { loadDisplayPrefs, saveDisplayPrefs } from "@/lib/displayPrefs";
import { useIsMobile } from "@/lib/useIsMobile";

type BlockTimerProps = {
  totalSeconds: number;
  onComplete: () => void;
  isActive: boolean;
  mindState: string;
  mindStateLog: Array<{ time: number; state: string }>;
  onElapsedChange?: (elapsed: number) => void;
  soundPrefs?: SoundPrefs;
  /**
   * When set, elapsed time is driven by the parent (e.g. server-synced buddy session).
   * Sounds and block fill still run from this value; local wall-clock interval is disabled.
   */
  controlledElapsed?: number;
  /**
   * Buddy / server-synced: same 50ms smooth updates as solo, using server timestamps from polls.
   * When set, takes precedence over `controlledElapsed`.
   */
  syncClock?: {
    startedAt: string;
    serverNow: string;
    durationSeconds: number;
  };
};

type BlockDef = {
  duration: number;
  startTime: number;
  label: string;
  type: "minute" | "second";
};

export function BlockTimer({
  totalSeconds,
  onComplete,
  isActive,
  mindState,
  mindStateLog,
  onElapsedChange,
  soundPrefs,
  controlledElapsed,
  syncClock,
}: BlockTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pausedElapsedRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const soundPrefsRef = useRef(soundPrefs);
  soundPrefsRef.current = soundPrefs;
  const lastTickSecRef = useRef(-1);
  const lastCompletedBlockIndexRef = useRef(-1);
  const controlledCompleteFiredRef = useRef(false);
  const skewRef = useRef(0);
  const syncClockRef = useRef(syncClock);
  syncClockRef.current = syncClock;
  const isMobile = useIsMobile();
  const isBuddySync = Boolean(syncClock?.startedAt && syncClock?.serverNow);
  const isControlled = controlledElapsed !== undefined && !isBuddySync;
  const [showTimer, setShowTimer] = useState(() => loadDisplayPrefs().showTimer);
  const blockSize = isMobile ? 56 : 75;
  const blockLabelSize = isMobile ? 13 : 17;
  const blockGap = 11;

  // Build block definitions
  const useMinuteBlocks = totalSeconds > 120;
  const fullMinutes = Math.floor(totalSeconds / 60);
  const minuteBlockCount = useMinuteBlocks
    ? (totalSeconds % 60 > 0 ? fullMinutes : fullMinutes - 1)
    : 0;
  const blocks: BlockDef[] = [];

  if (useMinuteBlocks) {
    for (let i = 0; i < minuteBlockCount; i++) {
      blocks.push({ duration: 60, startTime: i * 60, label: `${i + 1}m`, type: "minute" });
    }

    const lastMinuteStart = minuteBlockCount * 60;
    const lastMinuteDuration = totalSeconds - lastMinuteStart;
    const tenSecCount = Math.ceil(lastMinuteDuration / BLOCK_DURATION);
    for (let i = 0; i < tenSecCount; i++) {
      blocks.push({
        duration: BLOCK_DURATION,
        startTime: lastMinuteStart + i * BLOCK_DURATION,
        label: `${(i + 1) * BLOCK_DURATION}s`,
        type: "second",
      });
    }
  } else {
    const totalBlocks = Math.ceil(totalSeconds / BLOCK_DURATION);
    for (let i = 0; i < totalBlocks; i++) {
      blocks.push({
        duration: BLOCK_DURATION,
        startTime: i * BLOCK_DURATION,
        label: `${(i + 1) * BLOCK_DURATION}s`,
        type: "second",
      });
    }
  }

  const minuteBlocks = blocks.filter(b => b.type === "minute");
  const secondBlocks = blocks.filter(b => b.type === "second");

  useEffect(() => {
    if (!syncClock?.startedAt || !syncClock?.serverNow) return;
    skewRef.current = new Date(syncClock.serverNow).getTime() - Date.now();
  }, [syncClock?.startedAt, syncClock?.serverNow]);

  useEffect(() => {
    saveDisplayPrefs({ showTimer });
  }, [showTimer]);

  useEffect(() => {
    if (isControlled || isBuddySync) return;

    // Reset or seed refs based on whether this is a fresh session or a resume
    const resumeElapsed = pausedElapsedRef.current;
    const isResume = resumeElapsed > 0 && resumeElapsed < totalSeconds;

    if (isResume) {
      lastTickSecRef.current = Math.floor(resumeElapsed);
      lastCompletedBlockIndexRef.current = useMinuteBlocks
        ? Math.min(minuteBlockCount - 1, Math.floor(resumeElapsed / 60) - 1)
        : -1;
    } else {
      // Fresh session — clear all accumulated state
      lastCompletedBlockIndexRef.current = -1;
      lastTickSecRef.current = -1;
      pausedElapsedRef.current = 0;
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
          if (soundPrefsRef.current?.completion) playCompletion();
          onCompleteRef.current();
        } else {
          setElapsed(newElapsed);
          pausedElapsedRef.current = newElapsed;

          const currentSec = Math.floor(newElapsed);
          const remaining = totalSeconds - newElapsed;

          // Tick sound — once per second
          if (soundPrefsRef.current?.tick && currentSec > lastTickSecRef.current) {
            lastTickSecRef.current = currentSec;
            playTick();
          }

          // Always advance block progress so re-enabling chimes doesn't replay history
          if (useMinuteBlocks) {
            const completedBlockIndex = Math.min(
              minuteBlockCount - 1,
              Math.floor(newElapsed / 60) - 1,
            );

            if (completedBlockIndex > lastCompletedBlockIndexRef.current) {
              lastCompletedBlockIndexRef.current = completedBlockIndex;

              if (soundPrefsRef.current?.chime) {
                const blockEnd = (completedBlockIndex + 1) * 60;
                const chimeCount = Math.floor((totalSeconds - blockEnd) / 60);
                if (chimeCount >= 1) {
                  playChime(chimeCount);
                }
              }
            }
          }
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
    lastTickSecRef.current = Math.floor(seed);
    lastCompletedBlockIndexRef.current =
      useMinuteBlocks && minuteBlockCount > 0
        ? Math.min(minuteBlockCount - 1, Math.floor(seed / 60) - 1)
        : -1;
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
          if (soundPrefsRef.current?.completion) playCompletion();
          onCompleteRef.current();
        }
        return;
      }

      setElapsed(newElapsed);
      pausedElapsedRef.current = newElapsed;

      const currentSec = Math.floor(newElapsed);
      if (soundPrefsRef.current?.tick && currentSec > lastTickSecRef.current) {
        lastTickSecRef.current = currentSec;
        playTick();
      }

      if (useMinuteBlocks && minuteBlockCount > 0) {
        const completedBlockIndex = Math.min(
          minuteBlockCount - 1,
          Math.floor(newElapsed / 60) - 1,
        );
        if (completedBlockIndex > lastCompletedBlockIndexRef.current) {
          lastCompletedBlockIndexRef.current = completedBlockIndex;
          if (soundPrefsRef.current?.chime) {
            const blockEnd = (completedBlockIndex + 1) * 60;
            const chimeCount = Math.floor((duration - blockEnd) / 60);
            if (chimeCount >= 1) {
              playChime(chimeCount);
            }
          }
        }
      }
    }, 50);

    return () => window.clearInterval(id);
  }, [isBuddySync, isActive, syncClock?.startedAt, totalSeconds, useMinuteBlocks, minuteBlockCount]);

  useEffect(() => {
    if (!isControlled) return;
    const raw = controlledElapsed ?? 0;
    const newElapsed = Math.min(totalSeconds, Math.max(0, raw));

    if (newElapsed >= totalSeconds) {
      setElapsed(totalSeconds);
      pausedElapsedRef.current = totalSeconds;
      if (!controlledCompleteFiredRef.current) {
        controlledCompleteFiredRef.current = true;
        if (soundPrefsRef.current?.completion) playCompletion();
        onCompleteRef.current();
      }
      return;
    }

    setElapsed(newElapsed);
    pausedElapsedRef.current = newElapsed;

    const currentSec = Math.floor(newElapsed);
    if (soundPrefsRef.current?.tick && currentSec > lastTickSecRef.current) {
      lastTickSecRef.current = currentSec;
      playTick();
    }

    if (useMinuteBlocks && minuteBlockCount > 0) {
      const completedBlockIndex = Math.min(
        minuteBlockCount - 1,
        Math.floor(newElapsed / 60) - 1,
      );
      if (completedBlockIndex > lastCompletedBlockIndexRef.current) {
        lastCompletedBlockIndexRef.current = completedBlockIndex;
        if (soundPrefsRef.current?.chime) {
          const blockEnd = (completedBlockIndex + 1) * 60;
          const chimeCount = Math.floor((totalSeconds - blockEnd) / 60);
          if (chimeCount >= 1) {
            playChime(chimeCount);
          }
        }
      }
    }
  }, [
    isControlled,
    controlledElapsed,
    totalSeconds,
    useMinuteBlocks,
    minuteBlockCount,
  ]);

  useEffect(() => {
    onElapsedChange?.(elapsed);
  }, [elapsed, onElapsedChange]);

  const remaining = Math.max(0, totalSeconds - elapsed);
  const minutes = Math.floor(remaining / 60);
  const seconds = Math.floor(remaining % 60);

  const renderBlock = (block: BlockDef) => {
    const blockEnd = block.startTime + block.duration;
    const isFilled = elapsed >= blockEnd;
    const isCurrent = elapsed >= block.startTime && elapsed < blockEnd && elapsed < totalSeconds;
    const progress = isCurrent ? (elapsed - block.startTime) / block.duration : isFilled ? 1 : 0;

    return (
      <div key={`${block.type}-${block.startTime}`} style={{
        width: `${blockSize}px`, height: `${blockSize}px`, borderRadius: "10px",
        position: "relative", overflow: "hidden",
        border: `1px solid ${isFilled ? "var(--accent-green-border)" : isCurrent ? "var(--accent-amber-border)" : "var(--border-1)"}`,
        background: "var(--surface-1)",
        transition: "border-color 0.5s",
      }}>
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: `${progress * 100}%`,
          background: isFilled
            ? "linear-gradient(to top, var(--accent-green), var(--accent-green-end))"
            : "linear-gradient(to top, var(--accent-amber), var(--accent-amber-end))",
          transition: isFilled ? "height 0.3s" : "none",
          opacity: isFilled ? 0.85 : 0.7,
        }} />
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: `${blockLabelSize}px`,
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          color: isFilled ? "var(--overlay-text)" : "var(--fg-4)",
          fontWeight: 500, zIndex: 1,
        }}>
          {block.label}
        </div>
        {isCurrent && (
          <div style={{
            position: "absolute", inset: "-1px", borderRadius: "10px",
            border: "1px solid var(--accent-amber-dim)",
            animation: "pulse 2s ease-in-out infinite",
          }} />
        )}
      </div>
    );
  };

  const boxesAreaWidth = `min(${6 * blockSize + blockGap * 5}px, calc(100vw - 24px))`;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "32px" }}>
      <div
        style={{
          width: "min(560px, calc(100vw - 24px))",
          position: "relative",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          aria-hidden={!showTimer}
          style={{
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', 'SF Mono', monospace",
            fontSize: "min(120px, 18vw)",
            fontWeight: 200,
            letterSpacing: "0.05em",
            color: elapsed >= totalSeconds ? "var(--accent-green)" : "var(--fg)",
            textShadow: elapsed >= totalSeconds ? "0 0 40px var(--accent-green-glow)" : "none",
            transition: "color 0.8s, text-shadow 0.8s, opacity 0.25s ease",
            opacity: showTimer ? 1 : 0,
            minHeight: "1em",
            userSelect: "none",
          }}
        >
          {minutes}:{seconds.toString().padStart(2, "0")}
        </div>
        <button
          type="button"
          aria-pressed={showTimer}
          aria-label={showTimer ? "Hide numerical timer" : "Show numerical timer"}
          onClick={() => setShowTimer(prev => !prev)}
          style={{
            position: "absolute",
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            border: "1px solid var(--border-2)",
            background: "var(--surface-1)",
            color: "var(--fg-3)",
            borderRadius: "999px",
            cursor: "pointer",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "8px 12px",
            transition: "opacity 0.2s, border-color 0.2s, color 0.2s",
            opacity: showTimer ? 0.9 : 1,
          }}
        >
          {showTimer ? "hide" : "show"}
        </button>
      </div>

      <div style={{ width: boxesAreaWidth, margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px" }}>
        <MindStateBar
          elapsed={elapsed}
          totalSeconds={totalSeconds}
          mindStateLog={mindStateLog}
          currentState={mindState}
          barWidth={boxesAreaWidth}
        />
        <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: "14px" }}>
          <div style={{
            height: "8px", borderRadius: "4px", overflow: "hidden",
            background: "var(--surface-2)",
          }}>
            <div style={{
              width: `${elapsed >= totalSeconds ? 100 : ((elapsed % 60) / 60) * 100}%`,
              height: "100%",
              background: elapsed >= totalSeconds
                ? "linear-gradient(to right, var(--accent-green), var(--accent-green-end))"
                : "linear-gradient(to right, var(--accent-amber), var(--accent-amber-end))",
              opacity: 0.7,
              transition: elapsed >= totalSeconds ? "width 0.3s" : "none",
              borderRadius: "4px",
            }} />
          </div>
        </div>
      </div>

      {useMinuteBlocks ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
          <div style={{
            display: "flex", flexWrap: "wrap", gap: blockGap,
            justifyContent: "center", maxWidth: boxesAreaWidth,
          }}>
            {minuteBlocks.map(b => renderBlock(b))}
          </div>
          <div style={{
            width: "100%", borderTop: "1px solid var(--border-1)",
            paddingTop: "4px",
          }}>
            <div style={{
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px", color: "var(--fg-4)",
              textAlign: "center", marginBottom: "8px",
              letterSpacing: "0.1em", textTransform: "uppercase",
            }}>
              final minute
            </div>
            <div style={{
              display: "flex", flexWrap: "wrap", gap: blockGap,
              justifyContent: "center", maxWidth: boxesAreaWidth,
            }}>
              {secondBlocks.map(b => renderBlock(b))}
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: blockGap,
          justifyContent: "center", maxWidth: boxesAreaWidth,
        }}>
          {blocks.map(b => renderBlock(b))}
        </div>
      )}
    </div>
  );
}
