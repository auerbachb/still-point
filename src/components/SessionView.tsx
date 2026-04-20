"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { BASE_DURATION, INCREMENT } from "@/lib/constants";
import { BlockTimer } from "./BlockTimer";
import { ThoughtCapture } from "./ThoughtCapture";
import { loadSoundPrefs, saveSoundPrefs, type SoundPrefs } from "@/lib/audio";
import { computeClearPercentFromLog, isMindStateTypingTarget } from "@/lib/mindStateSession";

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
  const mindStateRef = useRef(mindState);
  mindStateRef.current = mindState;

  const [mindStateLog, setMindStateLog] = useState<Array<{ time: number; state: string }>>([]);
  const mindStateLogRef = useRef(mindStateLog);
  useEffect(() => {
    mindStateLogRef.current = mindStateLog;
  }, [mindStateLog]);
  const [showPostDistractionCapture, setShowPostDistractionCapture] = useState(false);
  const [sessionThoughts, setSessionThoughts] = useState<Array<{ timeInSession: number; text: string }>>([]);
  const [sessionThoughtCount, setSessionThoughtCount] = useState(0);
  const elapsedRef = useRef(0);
  /** Drives re-renders while the timer runs so awareness % stays in sync with elapsed time. */
  const [, setLiveElapsed] = useState(0);
  const wallStartRef = useRef<number>(Date.now());
  const [soundPrefs, setSoundPrefs] = useState<SoundPrefs>(() => loadSoundPrefs());
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** True while pointer or space is actively holding the distraction control */
  const holdActiveRef = useRef(false);
  const spaceDownRef = useRef(false);

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

  const finalizeActiveDistraction = useCallback((atTime: number, offerThoughtCapture: boolean) => {
    if (mindStateRef.current !== "thinking") return;
    setMindState("clear");
    mindStateRef.current = "clear";
    setMindStateLog(prev => {
      const next = [...prev, { time: atTime, state: "clear" }];
      mindStateLogRef.current = next;
      return next;
    });
    setShowPostDistractionCapture(offerThoughtCapture);
  }, []);

  const beginDistraction = useCallback(() => {
    if (!isActive || mindStateRef.current !== "clear") return;
    setShowPostDistractionCapture(false);
    setMindState("thinking");
    mindStateRef.current = "thinking";
    setMindStateLog(prev => {
      const next = [...prev, { time: elapsedRef.current, state: "thinking" }];
      mindStateLogRef.current = next;
      return next;
    });
    setSessionThoughtCount(prev => prev + 1);
  }, [isActive]);

  const endDistractionHold = useCallback(() => {
    if (!holdActiveRef.current) return;
    holdActiveRef.current = false;
    finalizeActiveDistraction(elapsedRef.current, true);
  }, [finalizeActiveDistraction]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (!isActive || isMindStateTypingTarget(e.target)) return;
      e.preventDefault();
      spaceDownRef.current = true;
      if (!holdActiveRef.current) {
        holdActiveRef.current = true;
        beginDistraction();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (!spaceDownRef.current) return;
      spaceDownRef.current = false;
      e.preventDefault();
      endDistractionHold();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
    };
  }, [isActive, beginDistraction, endDistractionHold]);

  const calcClearPercent = useCallback(() => {
    const endTime = elapsedRef.current || todayDuration;
    return computeClearPercentFromLog(mindStateLog, endTime);
  }, [mindStateLog, todayDuration]);

  const snapshotForComplete = useCallback(() => {
    const at = elapsedRef.current;
    setShowPostDistractionCapture(false);
    if (mindStateRef.current !== "thinking") {
      return mindStateLogRef.current;
    }
    setMindState("clear");
    mindStateRef.current = "clear";
    const next = [...mindStateLogRef.current, { time: at, state: "clear" }];
    mindStateLogRef.current = next;
    setMindStateLog(next);
    return next;
  }, []);

  const handleComplete = useCallback(() => {
    const resolvedLog = snapshotForComplete();
    setIsActive(false);
    const actualTime = Math.round((Date.now() - wallStartRef.current) / 1000);
    const endT = elapsedRef.current || todayDuration;
    onComplete({
      dayNumber: currentDay,
      duration: todayDuration,
      completed: true,
      actualTime,
      clearPercent: computeClearPercentFromLog(resolvedLog, endT),
      thoughtCount: sessionThoughtCount,
      mindStateLog: resolvedLog,
      thoughts: sessionThoughts,
    });
  }, [currentDay, todayDuration, sessionThoughtCount, sessionThoughts, onComplete, snapshotForComplete]);

  const handlePointerDistractionDown = () => {
    if (!isActive || mindStateRef.current !== "clear") return;
    holdActiveRef.current = true;
    beginDistraction();
  };

  const handlePointerDistractionUp = () => {
    if (!holdActiveRef.current) return;
    holdActiveRef.current = false;
    finalizeActiveDistraction(elapsedRef.current, true);
  };

  const handleSaveThought = (text: string) => {
    setSessionThoughts(prev => [...prev, { timeInSession: Math.round(elapsedRef.current), text }]);
    setShowPostDistractionCapture(false);
  };

  const handleDismissPostCapture = () => {
    setShowPostDistractionCapture(false);
  };

  const handleEndEarly = () => {
    const resolvedLog = snapshotForComplete();
    setIsActive(false);
    const actualTime = Math.round((Date.now() - wallStartRef.current) / 1000);
    const endT = elapsedRef.current || todayDuration;
    onComplete({
      dayNumber: currentDay,
      duration: todayDuration,
      completed: false,
      actualTime,
      clearPercent: computeClearPercentFromLog(resolvedLog, endT),
      thoughtCount: sessionThoughtCount,
      mindStateLog: resolvedLog,
      thoughts: sessionThoughts,
    });
  };

  const handleAbandon = () => {
    const resolvedLog = snapshotForComplete();
    setIsActive(false);
    const actualTime = Math.round((Date.now() - wallStartRef.current) / 1000);
    const endT = elapsedRef.current || todayDuration;
    onAbandon({
      dayNumber: currentDay,
      duration: todayDuration,
      completed: false,
      actualTime,
      clearPercent: computeClearPercentFromLog(resolvedLog, endT),
      thoughtCount: sessionThoughtCount,
      mindStateLog: resolvedLog,
      thoughts: sessionThoughts,
    });
  };

  const handleElapsedChange = useCallback((elapsed: number) => {
    elapsedRef.current = elapsed;
    setLiveElapsed(elapsed);
  }, []);

  const togglePause = () => {
    if (isActive) {
      if (holdActiveRef.current) {
        holdActiveRef.current = false;
        spaceDownRef.current = false;
      }
      finalizeActiveDistraction(elapsedRef.current, false);
    }
    setIsActive(a => !a);
  };

  const distractionPercent = 100 - calcClearPercent();

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

      {/* Persistent aware / distracted indicator (visible even when controls fade) */}
      {isActive && (
        <div style={{ width: "100%", maxWidth: "min(420px, calc(100vw - 24px))", marginTop: "12px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--fg-3)",
              justifyContent: "center",
            }}
          >
            <span
              aria-hidden
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: mindState === "thinking" ? "var(--accent-amber)" : "var(--accent-green)",
                boxShadow: mindState === "thinking" ? "0 0 12px var(--accent-amber)" : "none",
                flexShrink: 0,
              }}
            />
            <span>{mindState === "thinking" ? "Distracted" : "Aware"}</span>
            {sessionThoughtCount > 0 && (
              <span style={{ color: "var(--accent-amber-border)", marginLeft: "4px" }}>
                · {sessionThoughtCount} {sessionThoughtCount === 1 ? "segment" : "segments"}
              </span>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "center", marginTop: "16px" }}>
            <button
              type="button"
              disabled={!isActive}
              aria-pressed={mindState === "thinking"}
              aria-label="Hold while distracted. Release when you are aware again."
              onMouseDown={e => { e.preventDefault(); handlePointerDistractionDown(); }}
              onMouseUp={handlePointerDistractionUp}
              onMouseLeave={() => {
                if (holdActiveRef.current) handlePointerDistractionUp();
              }}
              onTouchStart={e => {
                e.preventDefault();
                handlePointerDistractionDown();
              }}
              onTouchEnd={handlePointerDistractionUp}
              onTouchCancel={handlePointerDistractionUp}
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
                cursor: isActive ? "pointer" : "default",
                transition: "all 0.3s", minWidth: "200px",
                opacity: isActive ? 1 : 0.45,
              }}
            >
              {mindState === "thinking" ? "Release — aware again" : "Hold — distracted"}
            </button>
          </div>

          <p style={{
            margin: "10px 0 0",
            textAlign: "center",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "10px",
            color: "var(--fg-4)",
            letterSpacing: "0.06em",
          }}>
            Spacebar (hold) does the same when you are not typing in a field.
          </p>

          <div style={{
            marginTop: "14px",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "10px",
            color: "var(--fg-4)",
            letterSpacing: "0.08em",
            textAlign: "center",
          }}>
            <span style={{ color: "var(--accent-green-dim)" }}>{calcClearPercent()}% awareness</span>
            <span style={{ margin: "0 6px", color: "var(--fg-4)" }}>·</span>
            <span style={{ color: "var(--accent-amber-border)" }}>{distractionPercent}% distraction</span>
          </div>

          {showPostDistractionCapture && (
            <div
              data-no-space-distraction
              style={{ marginTop: "20px", width: "100%", display: "flex", justifyContent: "center" }}
            >
              <ThoughtCapture onSave={handleSaveThought} onCancel={handleDismissPostCapture} />
            </div>
          )}
        </div>
      )}

      <div style={{
        opacity: controlsVisible ? 1 : 0,
        transition: "opacity 0.5s ease",
        pointerEvents: controlsVisible ? "auto" : "none",
      }}>
        {!showPostDistractionCapture && (
          <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: "32px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={togglePause}
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
