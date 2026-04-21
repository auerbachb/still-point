"use client";

import { useState, useRef, useCallback, useEffect, type CSSProperties } from "react";
import { BASE_DURATION, INCREMENT } from "@/lib/constants";
import { BlockTimer } from "./BlockTimer";
import { ThoughtCapture } from "./ThoughtCapture";
import { loadSoundPrefs, saveSoundPrefs, type SoundPrefs } from "@/lib/audio";
import { computeClearPercentFromLog } from "@/lib/mindStateSession";
import { useMindStateHold } from "@/lib/useMindStateHold";

type MindState = "clear" | "thinking" | "hyperfocus";

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

const mono: CSSProperties = {
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
};

export function SessionView({ currentDay, onComplete, onAbandon }: SessionViewProps) {
  const todayDuration = BASE_DURATION + (currentDay - 1) * INCREMENT;
  const [isActive, setIsActive] = useState(true);
  const [mindState, setMindState] = useState<MindState>("clear");
  const mindStateRef = useRef<MindState>(mindState);
  mindStateRef.current = mindState;

  const [mindStateLog, setMindStateLog] = useState<Array<{ time: number; state: string }>>([]);
  const mindStateLogRef = useRef(mindStateLog);
  const [showPostDistractionCapture, setShowPostDistractionCapture] = useState(false);
  const [sessionThoughts, setSessionThoughts] = useState<Array<{ timeInSession: number; text: string }>>([]);
  const sessionThoughtsRef = useRef(sessionThoughts);
  sessionThoughtsRef.current = sessionThoughts;
  const [distractionSegmentCount, setDistractionSegmentCount] = useState(0);
  const elapsedRef = useRef(0);
  // First tuple element intentionally unused: only `setLiveElapsed` is called from
  // the timer callback to re-render awareness % while elapsed updates in a ref.
  const [, setLiveElapsed] = useState(0);
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

  const finalizeActiveHold = useCallback((atTime: number, offerThoughtCapture: boolean) => {
    const ms = mindStateRef.current;
    if (ms !== "thinking" && ms !== "hyperfocus") return;
    setMindState("clear");
    mindStateRef.current = "clear";
    setMindStateLog(prev => {
      const next = [...prev, { time: atTime, state: "clear" }];
      mindStateLogRef.current = next;
      return next;
    });
    if (ms === "thinking") {
      setShowPostDistractionCapture(offerThoughtCapture);
    }
  }, []);

  const beginDistraction = useCallback(() => {
    if (!isActive || mindStateRef.current !== "clear" || showPostDistractionCapture) return;
    setMindState("thinking");
    mindStateRef.current = "thinking";
    setMindStateLog(prev => {
      const next = [...prev, { time: elapsedRef.current, state: "thinking" }];
      mindStateLogRef.current = next;
      return next;
    });
    setDistractionSegmentCount(c => c + 1);
  }, [isActive, showPostDistractionCapture]);

  const beginHyperfocus = useCallback(() => {
    if (!isActive || mindStateRef.current !== "clear" || showPostDistractionCapture) return;
    setMindState("hyperfocus");
    mindStateRef.current = "hyperfocus";
    setMindStateLog(prev => {
      const next = [...prev, { time: elapsedRef.current, state: "hyperfocus" }];
      mindStateLogRef.current = next;
      return next;
    });
  }, [isActive, showPostDistractionCapture]);

  const endHoldFromKeyboard = useCallback(() => {
    finalizeActiveHold(elapsedRef.current, true);
  }, [finalizeActiveHold]);

  const { holdKindRef, resetHoldTracking } = useMindStateHold({
    enabled: isActive,
    beginDistraction,
    beginHyperfocus,
    endHoldFromKeyboard,
  });

  const calcClearPercent = useCallback(() => {
    const endTime = elapsedRef.current || todayDuration;
    return computeClearPercentFromLog(mindStateLog, endTime);
  }, [mindStateLog, todayDuration]);

  const snapshotForComplete = useCallback(() => {
    const at = elapsedRef.current;
    setShowPostDistractionCapture(false);
    resetHoldTracking();
    if (mindStateRef.current === "clear") {
      return mindStateLogRef.current;
    }
    setMindState("clear");
    mindStateRef.current = "clear";
    const next = [...mindStateLogRef.current, { time: at, state: "clear" }];
    mindStateLogRef.current = next;
    setMindStateLog(next);
    return next;
  }, [resetHoldTracking]);

  const payloadThoughtCount = () => sessionThoughtsRef.current.length;

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
      thoughtCount: payloadThoughtCount(),
      mindStateLog: resolvedLog,
      thoughts: sessionThoughtsRef.current,
    });
  }, [currentDay, todayDuration, onComplete, snapshotForComplete]);

  const handlePointerDistractionDown = () => {
    if (!isActive || mindStateRef.current !== "clear" || showPostDistractionCapture) return;
    holdKindRef.current = "pointerHold";
    beginDistraction();
  };

  const handlePointerDistractionUp = () => {
    if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "thinking") return;
    holdKindRef.current = "none";
    finalizeActiveHold(elapsedRef.current, true);
  };

  const handlePointerHyperfocusDown = () => {
    if (!isActive || mindStateRef.current !== "clear" || showPostDistractionCapture) return;
    holdKindRef.current = "pointerHold";
    beginHyperfocus();
  };

  const handlePointerHyperfocusUp = () => {
    if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "hyperfocus") return;
    holdKindRef.current = "none";
    finalizeActiveHold(elapsedRef.current, false);
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
      thoughtCount: payloadThoughtCount(),
      mindStateLog: resolvedLog,
      thoughts: sessionThoughtsRef.current,
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
      thoughtCount: payloadThoughtCount(),
      mindStateLog: resolvedLog,
      thoughts: sessionThoughtsRef.current,
    });
  };

  const handleElapsedChange = useCallback((elapsed: number) => {
    elapsedRef.current = elapsed;
    setLiveElapsed(elapsed);
  }, []);

  const togglePause = () => {
    if (isActive) {
      resetHoldTracking();
      finalizeActiveHold(elapsedRef.current, false);
    }
    setIsActive(a => !a);
  };

  const distractionPercent = Math.max(0, 100 - calcClearPercent());
  const stateLabel =
    mindState === "thinking" ? "Distracted" : mindState === "hyperfocus" ? "Hyperfocus" : "Aware";
  const capturedCount = sessionThoughts.length;

  const holdButtonBase: CSSProperties = {
    ...mono,
    fontSize: "12px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    padding: "12px 16px",
    borderRadius: "16px",
    cursor: isActive ? "pointer" : "default",
    transition: "all 0.25s",
    flex: "1 1 140px",
    minWidth: "min(160px, 42vw)",
    maxWidth: "200px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    border: "1px solid var(--border-2)",
    background: "var(--surface-1)",
    color: "var(--fg-2)",
    opacity: isActive ? 1 : 0.45,
  };

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

      {isActive && (
        <div style={{ width: "100%", maxWidth: "min(440px, calc(100vw - 40px))", marginTop: "12px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              ...mono,
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
                background:
                  mindState === "thinking"
                    ? "var(--accent-amber)"
                    : mindState === "hyperfocus"
                      ? "rgba(96, 165, 250, 0.95)"
                      : "var(--accent-green)",
                boxShadow:
                  mindState === "thinking"
                    ? "0 0 12px var(--accent-amber)"
                    : mindState === "hyperfocus"
                      ? "0 0 12px rgba(59, 130, 246, 0.6)"
                      : "none",
                flexShrink: 0,
              }}
            />
            <span>{stateLabel}</span>
            {distractionSegmentCount > 0 && (
              <span style={{ color: "var(--accent-amber-border)", marginLeft: "4px" }}>
                · {distractionSegmentCount} light {distractionSegmentCount === 1 ? "segment" : "segments"}
              </span>
            )}
            {capturedCount > 0 && (
              <span style={{ color: "var(--accent-amber-border)", marginLeft: "4px" }}>
                · {capturedCount} captured {capturedCount === 1 ? "note" : "notes"}
              </span>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "12px",
              marginTop: "16px",
              width: "100%",
            }}
          >
            <button
              type="button"
              disabled={!isActive}
              aria-pressed={mindState === "thinking"}
              aria-label="Hold for light distraction, or hold Space. Release when aware again."
              onMouseDown={e => {
                e.preventDefault();
                handlePointerDistractionDown();
              }}
              onMouseUp={handlePointerDistractionUp}
              onMouseLeave={() => {
                if (holdKindRef.current === "pointerHold" && mindStateRef.current === "thinking") {
                  handlePointerDistractionUp();
                }
              }}
              onTouchStart={e => {
                e.preventDefault();
                handlePointerDistractionDown();
              }}
              onTouchEnd={handlePointerDistractionUp}
              onTouchCancel={handlePointerDistractionUp}
              style={{
                ...holdButtonBase,
                borderColor:
                  mindState === "thinking" ? "var(--accent-amber-border)" : "var(--accent-green-border-subtle)",
                background:
                  mindState === "thinking" ? "var(--accent-amber-bg)" : "var(--accent-green-bg-subtle)",
                color: mindState === "thinking" ? "var(--accent-amber)" : "var(--accent-green)",
              }}
            >
              <span>{mindState === "thinking" ? "Release" : "Hold"} — light distraction</span>
              <span style={{ ...mono, fontSize: "9px", letterSpacing: "0.14em", opacity: 0.85, textTransform: "none" }}>
                or hold Space
              </span>
            </button>

            <button
              type="button"
              disabled={!isActive}
              aria-pressed={mindState === "hyperfocus"}
              aria-label="Hold for hyperfocus, or hold Comma. Release to return to aware."
              onMouseDown={e => {
                e.preventDefault();
                handlePointerHyperfocusDown();
              }}
              onMouseUp={handlePointerHyperfocusUp}
              onMouseLeave={() => {
                if (holdKindRef.current === "pointerHold" && mindStateRef.current === "hyperfocus") {
                  handlePointerHyperfocusUp();
                }
              }}
              onTouchStart={e => {
                e.preventDefault();
                handlePointerHyperfocusDown();
              }}
              onTouchEnd={handlePointerHyperfocusUp}
              onTouchCancel={handlePointerHyperfocusUp}
              style={{
                ...holdButtonBase,
                borderColor:
                  mindState === "hyperfocus" ? "rgba(59, 130, 246, 0.55)" : "var(--border-2)",
                background:
                  mindState === "hyperfocus" ? "rgba(59, 130, 246, 0.12)" : "var(--surface-1)",
                color: mindState === "hyperfocus" ? "rgba(147, 197, 253, 0.95)" : "var(--fg-2)",
              }}
            >
              <span>{mindState === "hyperfocus" ? "Release" : "Hold"} — hyperfocus</span>
              <span style={{ ...mono, fontSize: "9px", letterSpacing: "0.14em", opacity: 0.85, textTransform: "none" }}>
                or hold ,
              </span>
            </button>
          </div>

          <p
            style={{
              margin: "12px 0 0",
              textAlign: "center",
              ...mono,
              fontSize: "10px",
              color: "var(--fg-4)",
              letterSpacing: "0.05em",
              lineHeight: 1.45,
            }}
          >
            After a light distraction, you can jot a note (optional). If you need to stop and write because the thought
            will not wait, use captured notes — that is tracked separately as a stronger pull.
          </p>

          <div
            style={{
              marginTop: "12px",
              ...mono,
              fontSize: "10px",
              color: "var(--fg-4)",
              letterSpacing: "0.08em",
              textAlign: "center",
            }}
          >
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

      <div
        style={{
          opacity: controlsVisible ? 1 : 0,
          transition: "opacity 0.5s ease",
          pointerEvents: controlsVisible ? "auto" : "none",
        }}
      >
        {!showPostDistractionCapture && (
          <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: "32px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={togglePause}
              style={{
                background: "none",
                border: "1px solid var(--border-2)",
                color: "var(--fg-3)",
                ...mono,
                fontSize: "11px",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                padding: "10px 24px",
                borderRadius: "20px",
                cursor: "pointer",
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
                ...mono,
                fontSize: "11px",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                padding: "10px 24px",
                borderRadius: "20px",
                cursor: "pointer",
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
                ...mono,
                fontSize: "11px",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                padding: "10px 24px",
                borderRadius: "20px",
                cursor: "pointer",
              }}
            >
              abandon
            </button>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "16px",
            marginTop: "24px",
            ...mono,
            fontSize: "11px",
            letterSpacing: "0.1em",
          }}
        >
          {(
            [
              ["tick", "tick"],
              ["chime", "chime"],
              ["completion", "end"],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              onClick={() => {
                const next = { ...soundPrefs, [key]: !soundPrefs[key] };
                setSoundPrefs(next);
                saveSoundPrefs(next);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: soundPrefs[key] ? "var(--fg-3)" : "var(--fg-4)",
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
