"use client";

import { useState, useEffect } from "react";
import { MindStateBar } from "./MindStateBar";
import type { SoundPrefs } from "@/lib/audio";
import { buildBlocks, usesMinuteBlocks, type BlockDef } from "@/lib/blockTimerGrid";
import { loadDisplayPrefs, saveDisplayPrefs } from "@/lib/displayPrefs";
import { useElapsedClock, type SyncClock } from "@/lib/useElapsedClock";
import { useIsMobile } from "@/lib/useIsMobile";
import { useSessionCues } from "@/lib/useSessionCues";

type BlockTimerProps = {
  totalSeconds: number;
  onComplete: () => void;
  isActive: boolean;
  mindState: string;
  mindStateLog: Array<{ time: number; state: string }>;
  onElapsedChange?: (elapsed: number) => void;
  onSoundPlaybackBlocked?: () => void;
  /** Fires when a failed sound plays after the automatic resume retry succeeds. */
  onSoundPlaybackResumed?: () => void;
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
  syncClock?: SyncClock;
  /**
   * #669 "just the timer": render the numeric countdown alone — no mind-state bar,
   * progress bar, block grid, or show/hide toggle. The clock, sounds, and
   * completion callback are unaffected, so the sit runs exactly as it does in the
   * full view.
   */
  minimal?: boolean;
};

/**
 * The countdown a sit is watched on: the digits, the mind-state and minute
 * progress bars, and the block grid.
 *
 * #732: rendering only. The clocks live in `useElapsedClock`, what the sit
 * plays and when in `useSessionCues` / `sessionCues.ts`, and the grid layout in
 * `blockTimerGrid.ts`.
 */
export function BlockTimer({
  totalSeconds,
  onComplete,
  isActive,
  mindState,
  mindStateLog,
  onElapsedChange,
  onSoundPlaybackBlocked,
  onSoundPlaybackResumed,
  soundPrefs,
  controlledElapsed,
  syncClock,
  minimal = false,
}: BlockTimerProps) {
  const isMobile = useIsMobile();
  const [showTimer, setShowTimer] = useState(() => loadDisplayPrefs().showTimer);
  const blockSize = isMobile ? 56 : 75;
  const blockLabelSize = isMobile ? 13 : 17;
  const blockGap = 11;

  const cues = useSessionCues({
    isActive,
    soundPrefs,
    onSoundPlaybackBlocked,
    onSoundPlaybackResumed,
  });
  const elapsed = useElapsedClock({
    totalSeconds,
    isActive,
    controlledElapsed,
    syncClock,
    onComplete,
    onElapsedChange,
    cues,
  });

  useEffect(() => {
    saveDisplayPrefs({ showTimer });
  }, [showTimer]);

  const useMinuteBlocks = usesMinuteBlocks(totalSeconds);
  const blocks = buildBlocks(totalSeconds);
  const minuteBlocks = blocks.filter(b => b.type === "minute");
  const secondBlocks = blocks.filter(b => b.type === "second");

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
          fontFamily: "var(--font-mono)",
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

  const boxesAreaMaxPx = 6 * blockSize + blockGap * 5;
  const boxesAreaViewportInset = boxesAreaMaxPx > 500 ? 24 : 40;
  const boxesAreaWidth = `min(${boxesAreaMaxPx}px, calc(100vw - ${boxesAreaViewportInset}px))`;

  // #669: minimal view *is* the countdown, so the "hide numerical timer" display
  // preference is bypassed while minimal — honouring it there would leave a blank
  // screen with no way to read the sit. The stored preference is left untouched.
  const digitsVisible = minimal || showTimer;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: isMobile ? "18px" : "32px" }}>
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
          data-session-timer-digits
          aria-hidden={!digitsVisible}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: isMobile ? "min(72px, 19vw)" : "min(120px, 18vw)",
            fontWeight: 200,
            letterSpacing: "0.05em",
            color: elapsed >= totalSeconds ? "var(--accent-green)" : "var(--fg)",
            textShadow: elapsed >= totalSeconds ? "0 0 40px var(--accent-green-glow)" : "none",
            transition: "color 0.8s, text-shadow 0.8s, opacity 0.25s ease",
            opacity: digitsVisible ? 1 : 0,
            minHeight: "1em",
            userSelect: "none",
          }}
        >
          {minutes}:{seconds.toString().padStart(2, "0")}
        </div>
        {!minimal && (
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
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "12px 16px",
            minHeight: "44px",
            minWidth: "44px",
            transition: "opacity 0.2s, border-color 0.2s, color 0.2s",
            opacity: showTimer ? 0.9 : 1,
          }}
        >
          {showTimer ? "hide" : "show"}
        </button>
        )}
      </div>

      {!minimal && (
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
      )}

      {minimal ? null : useMinuteBlocks ? (
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
              fontFamily: "var(--font-mono)",
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
