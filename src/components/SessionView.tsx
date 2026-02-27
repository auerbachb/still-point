"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { BASE_DURATION, INCREMENT } from "@/lib/constants";
import { BlockTimer } from "./BlockTimer";
import { ThoughtCapture } from "./ThoughtCapture";
import { loadSoundPrefs, saveSoundPrefs, type SoundPrefs } from "@/lib/audio";

type SessionViewProps = {
  currentDay: number;
  onComplete: (data: {
    dayNumber: number;
    duration: number;
    completed: boolean;
    actualTime: number;
    clearPercent: number;
    thoughtCount: number;
    mindStateLog: Array<{ time: number; state: string }>;
    thoughts: Array<{ timeInSession: number; text: string }>;
  }) => void;
  onAbandon: (data: {
    dayNumber: number;
    duration: number;
    completed: boolean;
    actualTime: number;
    clearPercent: number;
    thoughtCount: number;
    mindStateLog: Array<{ time: number; state: string }>;
    thoughts: Array<{ timeInSession: number; text: string }>;
  }) => void;
};

export function SessionView({ currentDay, onComplete, onAbandon }: SessionViewProps) {
  const todayDuration = BASE_DURATION + (currentDay - 1) * INCREMENT;
  const [isActive, setIsActive] = useState(true);
  const [mindState, setMindState] = useState("clear");
  const [mindStateLog, setMindStateLog] = useState<Array<{ time: number; state: string }>>([]);
  const [showThoughtInput, setShowThoughtInput] = useState(false);
  const [sessionThoughts, setSessionThoughts] = useState<Array<{ timeInSession: number; text: string }>>([]);
  const [sessionThoughtCount, setSessionThoughtCount] = useState(0);
  const elapsedRef = useRef(0);
  const wallStartRef = useRef<number>(Date.now());
  const [soundPrefs, setSoundPrefs] = useState<SoundPrefs>(() => loadSoundPrefs());
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const resetTimer = () => {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 1000);
    };
    resetTimer();
    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("mousedown", resetTimer);
    window.addEventListener("keydown", resetTimer);
    window.addEventListener("touchstart", resetTimer, { passive: true });
    return () => {
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("mousedown", resetTimer);
      window.removeEventListener("keydown", resetTimer);
      window.removeEventListener("touchstart", resetTimer);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const calcClearPercent = useCallback(() => {
    if (mindStateLog.length === 0) return 100;
    let clearTime = 0;
    let lastTime = 0;
    let lastState = "clear";
    const endTime = elapsedRef.current || todayDuration;
    const log = [...mindStateLog, { time: endTime, state: "clear" }];
    for (const entry of log) {
      if (lastState === "clear") clearTime += entry.time - lastTime;
      lastTime = entry.time;
      lastState = entry.state;
    }
    return Math.round((clearTime / endTime) * 100);
  }, [mindStateLog, todayDuration]);

  const handleComplete = useCallback(() => {
    setIsActive(false);
    const actualTime = Math.round((Date.now() - wallStartRef.current) / 1000);
    onComplete({
      dayNumber: currentDay,
      duration: todayDuration,
      completed: true,
      actualTime,
      clearPercent: calcClearPercent(),
      thoughtCount: sessionThoughtCount,
      mindStateLog,
      thoughts: sessionThoughts,
    });
  }, [currentDay, todayDuration, sessionThoughtCount, mindStateLog, sessionThoughts, onComplete, calcClearPercent]);

  const handleThinkingToggle = () => {
    const now = elapsedRef.current;
    if (mindState === "clear") {
      setMindState("thinking");
      setMindStateLog(prev => [...prev, { time: now, state: "thinking" }]);
      setSessionThoughtCount(prev => prev + 1);
      setShowThoughtInput(true);
    } else {
      setMindState("clear");
      setMindStateLog(prev => [...prev, { time: now, state: "clear" }]);
      setShowThoughtInput(false);
    }
  };

  const handleSaveThought = (text: string) => {
    setSessionThoughts(prev => [...prev, { timeInSession: Math.round(elapsedRef.current), text }]);
    setMindState("clear");
    setMindStateLog(prev => [...prev, { time: elapsedRef.current, state: "clear" }]);
    setShowThoughtInput(false);
  };

  const handleSkipThought = () => {
    setMindState("clear");
    setMindStateLog(prev => [...prev, { time: elapsedRef.current, state: "clear" }]);
    setShowThoughtInput(false);
  };

  const handleEndEarly = () => {
    setIsActive(false);
    const actualTime = Math.round((Date.now() - wallStartRef.current) / 1000);
    onComplete({
      dayNumber: currentDay,
      duration: todayDuration,
      completed: false,
      actualTime,
      clearPercent: calcClearPercent(),
      thoughtCount: sessionThoughtCount,
      mindStateLog,
      thoughts: sessionThoughts,
    });
  };

  const handleAbandon = () => {
    setIsActive(false);
    const actualTime = Math.round((Date.now() - wallStartRef.current) / 1000);
    onAbandon({
      dayNumber: currentDay,
      duration: todayDuration,
      completed: false,
      actualTime,
      clearPercent: calcClearPercent(),
      thoughtCount: sessionThoughtCount,
      mindStateLog,
      thoughts: sessionThoughts,
    });
  };

  const handleElapsedChange = useCallback((elapsed: number) => {
    elapsedRef.current = elapsed;
  }, []);

  return (
    <div style={{ animation: "fadeIn 0.8s ease", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <BlockTimer
        totalSeconds={todayDuration}
        isActive={isActive}
        onComplete={handleComplete}
        mindState={mindState}
        mindStateLog={mindStateLog}
        onElapsedChange={handleElapsedChange}
        soundPrefs={soundPrefs}
      />

      <div style={{
        opacity: controlsVisible ? 1 : 0,
        transition: "opacity 0.5s ease",
        pointerEvents: controlsVisible ? "auto" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "32px", justifyContent: "center" }}>
          <button
            type="button"
            onClick={handleThinkingToggle}
            style={{
              background: mindState === "thinking"
                ? "var(--accent-amber-bg)"
                : "var(--accent-green-bg-subtle)",
              border: `1px solid ${mindState === "thinking"
                ? "var(--accent-amber-border)"
                : "var(--accent-green-border)"}`,
              color: mindState === "thinking" ? "var(--accent-amber)" : "var(--accent-green)",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase",
              padding: "12px 28px", borderRadius: "24px",
              cursor: "pointer", transition: "all 0.3s", minWidth: "160px",
            }}
          >
            {mindState === "thinking" ? "\u25CB clear mind" : "\u2726 I'm thinking"}
          </button>
          {sessionThoughtCount > 0 && (
            <div style={{
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px", color: "var(--accent-amber-border)",
              display: "flex", alignItems: "center", gap: "4px",
            }}>
              \uD83D\uDCAD {sessionThoughtCount}
            </div>
          )}
        </div>

        {showThoughtInput && (
          <div style={{ marginTop: "20px", width: "100%", display: "flex", justifyContent: "center" }}>
            <ThoughtCapture onSave={handleSaveThought} onCancel={handleSkipThought} />
          </div>
        )}

        {!showThoughtInput && (
          <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: "32px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              style={{
                background: "none",
                border: "1px solid var(--border-2)",
                color: "var(--fg-3)",
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "11px", letterSpacing: "0.15em", textTransform: "uppercase",
                padding: "10px 24px", borderRadius: "20px", cursor: "pointer",
              }}
            >
              {isActive ? "pause" : "resume"}
            </button>
            <button
              type="button"
              onClick={handleEndEarly}
              style={{
                background: "none",
                border: "1px solid var(--accent-green-border)",
                color: "var(--accent-green-dim)",
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "11px", letterSpacing: "0.15em", textTransform: "uppercase",
                padding: "10px 24px", borderRadius: "20px", cursor: "pointer",
              }}
            >
              end early &amp; keep
            </button>
            <button
              type="button"
              onClick={handleAbandon}
              style={{
                background: "none",
                border: "1px solid var(--accent-danger-border)",
                color: "var(--accent-danger-muted)",
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "11px", letterSpacing: "0.15em", textTransform: "uppercase",
                padding: "10px 24px", borderRadius: "20px", cursor: "pointer",
              }}
            >
              abandon
            </button>
          </div>
        )}

        {/* Sound toggles */}
        <div style={{
          display: "flex", justifyContent: "center", gap: "16px", marginTop: "24px",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "11px", letterSpacing: "0.1em",
        }}>
          {([
            ["tick", "tick"],
            ["chime", "chime"],
            ["completion", "end"],
          ] as const).map(([key, label]) => (
            <button
              type="button"
              key={key}
              onClick={() => {
                const next = { ...soundPrefs, [key]: !soundPrefs[key] };
                setSoundPrefs(next);
                saveSoundPrefs(next);
              }}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: soundPrefs[key]
                  ? "var(--fg-3)"
                  : "var(--fg-4)",
                transition: "color 0.3s",
                padding: "4px 8px",
              }}
            >
              {soundPrefs[key] ? "\u266A" : "\u2022"} {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
