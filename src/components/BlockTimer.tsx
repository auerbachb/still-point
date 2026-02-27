"use client";

import { useState, useEffect, useRef } from "react";
import { BLOCK_DURATION } from "@/lib/constants";
import { MindStateBar } from "./MindStateBar";
import { playTick, playChime, playCompletion, type SoundPrefs } from "@/lib/audio";
import { useIsMobile } from "@/lib/useIsMobile";

type BlockTimerProps = {
  totalSeconds: number;
  onComplete: () => void;
  isActive: boolean;
  mindState: string;
  mindStateLog: Array<{ time: number; state: string }>;
  onElapsedChange?: (elapsed: number) => void;
  soundPrefs?: SoundPrefs;
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
  const lastChimeMinRef = useRef(Math.ceil(totalSeconds / 60));
  const isMobile = useIsMobile();
  const blockSize = isMobile ? 56 : 75;
  const blockLabelSize = isMobile ? 13 : 17;

  // Build block definitions
  const useMinuteBlocks = totalSeconds > 120;
  const blocks: BlockDef[] = [];

  if (useMinuteBlocks) {
    const fullMinutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    const minuteBlockCount = remainingSeconds > 0 ? fullMinutes : fullMinutes - 1;

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

          // Minute chime — fire when remaining crosses a whole minute boundary downward
          if (soundPrefsRef.current?.chime) {
            const wholeMinutesLeft = Math.floor(remaining / 60);
            if (wholeMinutesLeft >= 1 && wholeMinutesLeft < lastChimeMinRef.current) {
              playChime(wholeMinutesLeft);
            }
            lastChimeMinRef.current = wholeMinutesLeft;
          }
        }
      }, 50);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, totalSeconds]);

  useEffect(() => {
    onElapsedChange?.(elapsed);
  }, [elapsed, onElapsedChange]);

  const remaining = Math.max(0, totalSeconds - elapsed);
  const minutes = Math.floor(remaining / 60);
  const seconds = Math.floor(remaining % 60);

  // Status label
  let statusLabel = "";
  if (elapsed >= totalSeconds) {
    statusLabel = "session complete";
  } else if (useMinuteBlocks) {
    const lastMinuteStart = minuteBlocks.length * 60;
    if (elapsed < lastMinuteStart) {
      const minIdx = Math.floor(elapsed / 60);
      statusLabel = `minute ${minIdx + 1} of ${minuteBlocks.length}`;
    } else {
      const secIdx = Math.floor((elapsed - lastMinuteStart) / BLOCK_DURATION);
      statusLabel = `final minute · block ${secIdx + 1} of ${secondBlocks.length}`;
    }
  } else {
    const blockIdx = Math.floor(elapsed / BLOCK_DURATION);
    statusLabel = `block ${blockIdx + 1} of ${blocks.length}`;
  }

  const renderBlock = (block: BlockDef) => {
    const blockEnd = block.startTime + block.duration;
    const isFilled = elapsed >= blockEnd;
    const isCurrent = elapsed >= block.startTime && elapsed < blockEnd && elapsed < totalSeconds;
    const progress = isCurrent ? (elapsed - block.startTime) / block.duration : isFilled ? 1 : 0;

    return (
      <div key={`${block.type}-${block.startTime}`} style={{
        width: `${blockSize}px`, height: `${blockSize}px`, borderRadius: "10px",
        position: "relative", overflow: "hidden",
        border: `1px solid ${isFilled ? "rgba(74,222,128,0.3)" : isCurrent ? "rgba(251,191,36,0.4)" : "var(--border-1)"}`,
        background: "var(--surface-1)",
        transition: "border-color 0.5s",
      }}>
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: `${progress * 100}%`,
          background: isFilled
            ? "linear-gradient(to top, #4ade80, #22c55e)"
            : "linear-gradient(to top, #fbbf24, #f59e0b)",
          transition: isFilled ? "height 0.3s" : "none",
          opacity: isFilled ? 0.85 : 0.7,
        }} />
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: `${blockLabelSize}px`,
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          color: isFilled ? "rgba(0,0,0,0.5)" : "var(--fg-4)",
          fontWeight: 500, zIndex: 1,
        }}>
          {block.label}
        </div>
        {isCurrent && (
          <div style={{
            position: "absolute", inset: "-1px", borderRadius: "10px",
            border: "1px solid rgba(251,191,36,0.5)",
            animation: "pulse 2s ease-in-out infinite",
          }} />
        )}
      </div>
    );
  };

  const rowMaxWidth = "min(505px, calc(100vw - 24px))";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "32px" }}>
      <div style={{
        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', 'SF Mono', monospace",
        fontSize: "min(120px, 18vw)", fontWeight: 200, letterSpacing: "0.05em",
        color: elapsed >= totalSeconds ? "#4ade80" : "var(--fg)",
        textShadow: elapsed >= totalSeconds ? "0 0 40px rgba(74,222,128,0.3)" : "none",
        transition: "color 0.8s, text-shadow 0.8s",
      }}>
        {minutes}:{seconds.toString().padStart(2, "0")}
      </div>

      {/* 60-second progress bar */}
      <div style={{ width: "min(460px, calc(100vw - 40px))", margin: "0 auto" }}>
        <div style={{
          height: "8px", borderRadius: "4px", overflow: "hidden",
          background: "var(--surface-2)",
        }}>
          <div style={{
            width: `${elapsed >= totalSeconds ? 100 : ((elapsed % 60) / 60) * 100}%`,
            height: "100%",
            background: elapsed >= totalSeconds
              ? "linear-gradient(to right, #4ade80, #22c55e)"
              : "linear-gradient(to right, #fbbf24, #f59e0b)",
            opacity: 0.7,
            transition: elapsed >= totalSeconds ? "width 0.3s" : "none",
            borderRadius: "4px",
          }} />
        </div>
      </div>

      {useMinuteBlocks ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
          <div style={{
            display: "flex", flexWrap: "wrap", gap: "11px",
            justifyContent: "center", maxWidth: rowMaxWidth,
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
              display: "flex", flexWrap: "wrap", gap: "11px",
              justifyContent: "center", maxWidth: rowMaxWidth,
            }}>
              {secondBlocks.map(b => renderBlock(b))}
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "11px",
          justifyContent: "center", maxWidth: rowMaxWidth,
        }}>
          {blocks.map(b => renderBlock(b))}
        </div>
      )}

      <MindStateBar
        elapsed={elapsed}
        totalSeconds={totalSeconds}
        mindStateLog={mindStateLog}
        currentState={mindState}
      />

      <div style={{
        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
        fontSize: "14px", color: "var(--fg-3)",
        letterSpacing: "0.15em", textTransform: "uppercase",
      }}>
        {statusLabel}
      </div>
    </div>
  );
}
