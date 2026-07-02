"use client";

import { useState, useRef, useCallback, useEffect, type CSSProperties } from "react";
import { type SessionType, type Track } from "@/lib/constants";
import { sessionDurationForUser, type RecoveryFields } from "@/lib/duration";
import { BlockTimer } from "./BlockTimer";
import { ThoughtCapture } from "./ThoughtCapture";
import { FlashHint } from "./FlashHint";
import { useIsMobile } from "@/lib/useIsMobile";
import { loadSoundPrefs, saveSoundPrefs, type SoundPrefs } from "@/lib/audio";
import { computeClearPercentFromLog } from "@/lib/mindStateSession";
import { useMindStateHold } from "@/lib/useMindStateHold";
import { useKeepScreenAwakePref, useWakeLock } from "@/lib/useWakeLock";
import { useSessionSuppressionRelay } from "@/lib/useSessionSuppression";

type MindState = "clear" | "thinking" | "hyperfocus";

const NO_RECOVERY: RecoveryFields = {
  recoveryTargetDay: null,
  recoveryCurrentStep: null,
  recoveryTotalSteps: null,
};

type SessionViewProps = {
  currentDay: number;
  recovery?: RecoveryFields;
  sessionType?: SessionType;
  /** #240: which daily track this sit belongs to; echoed back in the payloads. */
  track?: Track;
  onComplete: (data: {
    dayNumber: number;
    sessionType: SessionType;
    track: Track;
    duration: number;
    bonusSeconds: number;
    completed: boolean;
    actualTime: number;
    clearPercent: number;
    thoughtCount: number;
    mindStateLog: Array<{ time: number; state: string }>;
    thoughts: Array<{ timeInSession: number; text: string }>;
  }) => void;
  onAbandon: (data: {
    dayNumber: number;
    sessionType: SessionType;
    track: Track;
    duration: number;
    bonusSeconds: number;
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

export function SessionView({ currentDay, recovery = NO_RECOVERY, sessionType = "standard", track = "primary", onComplete, onAbandon }: SessionViewProps) {
  const isMobile = useIsMobile();
  const plannedSeconds = sessionDurationForUser(sessionType, currentDay, recovery);
  const [bonusSeconds, setBonusSeconds] = useState(0);
  const totalSeconds = plannedSeconds + bonusSeconds;
  const [sessionFinished, setSessionFinished] = useState(false);
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
  /** True after user pauses once this sit — keeps tracking UI (and ThoughtCapture) mounted while paused. */
  const [wasPausedInSession, setWasPausedInSession] = useState(false);
  /** Live opt-in Settings pref; pause/complete/abandon drop `isActive` and toggle-off releases too. */
  const keepScreenAwakePref = useKeepScreenAwakePref();
  useWakeLock(keepScreenAwakePref && isActive);
  // Relay sit state to the service worker so it can suppress push display while
  // a sit is in progress when the opt-in pref is on (#431). Treat a paused sit
  // as still "in session" so reminders stay suppressed until it truly ends.
  useSessionSuppressionRelay(!sessionFinished);

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

  const finalizeActiveHold = useCallback((atTime: number) => {
    const ms = mindStateRef.current;
    if (ms !== "thinking" && ms !== "hyperfocus") return;
    setMindState("clear");
    mindStateRef.current = "clear";
    setMindStateLog(prev => {
      const next = [...prev, { time: atTime, state: "clear" }];
      mindStateLogRef.current = next;
      return next;
    });
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
    finalizeActiveHold(elapsedRef.current);
  }, [finalizeActiveHold]);

  const { holdKindRef, resetHoldTracking } = useMindStateHold({
    enabled: isActive,
    beginDistraction,
    beginHyperfocus,
    endHoldFromKeyboard,
  });

  const calcClearPercent = useCallback(() => {
    const endTime = elapsedRef.current || totalSeconds;
    return computeClearPercentFromLog(mindStateLog, endTime);
  }, [mindStateLog, totalSeconds]);

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
    setWasPausedInSession(false);
    setSessionFinished(true);
    setIsActive(false);
    const actualTime = Math.round((Date.now() - wallStartRef.current) / 1000);
    const endT = elapsedRef.current || totalSeconds;
    onComplete({
      dayNumber: currentDay,
      sessionType,
      track,
      duration: plannedSeconds,
      bonusSeconds,
      completed: true,
      actualTime,
      clearPercent: computeClearPercentFromLog(resolvedLog, endT),
      thoughtCount: payloadThoughtCount(),
      mindStateLog: resolvedLog,
      thoughts: sessionThoughtsRef.current,
    });
  }, [currentDay, sessionType, track, plannedSeconds, bonusSeconds, totalSeconds, onComplete, snapshotForComplete]);

  const handlePointerDistractionDown = () => {
    if (!isActive || mindStateRef.current !== "clear" || showPostDistractionCapture) return;
    holdKindRef.current = "pointerHold";
    beginDistraction();
  };

  const handlePointerDistractionUp = () => {
    if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "thinking") return;
    holdKindRef.current = "none";
    finalizeActiveHold(elapsedRef.current);
  };

  const handlePointerHyperfocusDown = () => {
    if (!isActive || mindStateRef.current !== "clear" || showPostDistractionCapture) return;
    holdKindRef.current = "pointerHold";
    beginHyperfocus();
  };

  const handlePointerHyperfocusUp = () => {
    if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "hyperfocus") return;
    holdKindRef.current = "none";
    finalizeActiveHold(elapsedRef.current);
  };

  const handleOpenThoughtCapture = () => {
    finalizeActiveHold(elapsedRef.current);
    setShowPostDistractionCapture(true);
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
    setWasPausedInSession(false);
    setSessionFinished(true);
    setIsActive(false);
    const actualTime = Math.round((Date.now() - wallStartRef.current) / 1000);
    const endT = elapsedRef.current || totalSeconds;
    onComplete({
      dayNumber: currentDay,
      sessionType,
      track,
      duration: plannedSeconds,
      bonusSeconds,
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
    setWasPausedInSession(false);
    setSessionFinished(true);
    setIsActive(false);
    const actualTime = Math.round((Date.now() - wallStartRef.current) / 1000);
    const endT = elapsedRef.current || totalSeconds;
    onAbandon({
      dayNumber: currentDay,
      sessionType,
      track,
      duration: plannedSeconds,
      bonusSeconds,
      completed: false,
      actualTime,
      clearPercent: computeClearPercentFromLog(resolvedLog, endT),
      thoughtCount: payloadThoughtCount(),
      mindStateLog: resolvedLog,
      thoughts: sessionThoughtsRef.current,
    });
  };

  const extendSessionSeconds = useCallback((extra: number) => {
    if (sessionFinished || showPostDistractionCapture || !isActive) return;
    setBonusSeconds(b => b + extra);
  }, [sessionFinished, showPostDistractionCapture, isActive]);

  const handleElapsedChange = useCallback((elapsed: number) => {
    elapsedRef.current = elapsed;
    setLiveElapsed(elapsed);
  }, []);

  const togglePause = () => {
    if (isActive) {
      resetHoldTracking();
      finalizeActiveHold(elapsedRef.current);
      setWasPausedInSession(true);
    } else {
      setWasPausedInSession(false);
    }
    setIsActive(a => !a);
  };

  const distractionPercent = Math.max(0, 100 - calcClearPercent());
  const stateLabel =
    mindState === "thinking" ? "Distracted" : mindState === "hyperfocus" ? "Hyperfocus" : "Aware";
  const capturedCount = sessionThoughts.length;
  const sessionChromeDimmed = isActive && !controlsVisible;
  const showSessionTrackingLayer = isActive || wasPausedInSession;
  /** Capture stays in the persistent tracking layer while running so it is never hidden with secondary chrome. */
  const captureNoteButtonStyle: CSSProperties = {
    background: "none",
    border: "1px solid var(--accent-amber-border)",
    color: "var(--accent-amber-border)",
    ...mono,
    fontSize: "11px",
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    padding: "14px 24px",
    minHeight: "44px",
    minWidth: "44px",
    borderRadius: "20px",
    cursor: "pointer",
    transition: "opacity 0.5s ease",
  };

  const holdButtonBase: CSSProperties = {
    ...mono,
    fontSize: "12px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    padding: "12px 14px",
    borderRadius: "16px",
    cursor: isActive ? "pointer" : "default",
    transition: "all 0.25s",
    // On phones keep both holds on one row (was wrapping to two, adding height).
    flex: isMobile ? "1 1 0" : "1 1 140px",
    minWidth: isMobile ? 0 : "min(160px, 42vw)",
    maxWidth: isMobile ? "none" : "200px",
    minHeight: "44px",
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
        totalSeconds={totalSeconds}
        isActive={isActive}
        onComplete={handleComplete}
        mindState={mindState}
        mindStateLog={mindStateLog}
        onElapsedChange={handleElapsedChange}
        soundPrefs={soundPrefs}
      />

      {showSessionTrackingLayer && (
        <div
          data-session-tracking-layer="persistent"
          style={{ width: "100%", maxWidth: "min(440px, calc(100vw - 40px))", marginTop: "12px" }}
        >
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
              aria-label={isMobile ? "Hold for light distraction. Release when aware again." : "Hold for light distraction, or hold Space. Release when aware again."}
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
              {!isMobile && (
                <span style={{ ...mono, fontSize: "9px", letterSpacing: "0.14em", opacity: 0.85, textTransform: "none" }}>
                  or hold Space
                </span>
              )}
            </button>

            <button
              type="button"
              disabled={!isActive}
              aria-pressed={mindState === "hyperfocus"}
              aria-label={isMobile ? "Hold for hyperfocus. Release to return to aware." : "Hold for hyperfocus, or hold Comma. Release to return to aware."}
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
              {!isMobile && (
                <span style={{ ...mono, fontSize: "9px", letterSpacing: "0.14em", opacity: 0.85, textTransform: "none" }}>
                  or hold ,
                </span>
              )}
            </button>
          </div>

          <FlashHint>
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
              Light distraction holds only log awareness segments. Captured notes are reserved for explicit capture paths.
            </p>
          </FlashHint>

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

          {!showPostDistractionCapture && (
            <div style={{ marginTop: isMobile ? "12px" : "18px", display: "flex", justifyContent: "center", width: "100%" }}>
              <button
                type="button"
                onClick={handleOpenThoughtCapture}
                aria-label="Capture note"
                style={{
                  ...captureNoteButtonStyle,
                  opacity: sessionChromeDimmed ? 0.48 : 0.88,
                }}
              >
                capture note
              </button>
            </div>
          )}

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

      {!sessionFinished && !showPostDistractionCapture && (
        <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginTop: isMobile ? "12px" : "20px", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={sessionFinished || showPostDistractionCapture || !isActive}
            onClick={() => extendSessionSeconds(60)}
            aria-label="Add one minute to this session"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--border-2)",
              color: "var(--fg-2)",
              ...mono,
              fontSize: "11px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "12px 18px",
              minHeight: "44px",
              borderRadius: "16px",
              cursor: sessionFinished || showPostDistractionCapture || !isActive ? "default" : "pointer",
              opacity: sessionFinished || showPostDistractionCapture || !isActive ? 0.4 : 1,
            }}
          >
            +1 min
          </button>
          <button
            type="button"
            disabled={sessionFinished || showPostDistractionCapture || !isActive}
            onClick={() => extendSessionSeconds(300)}
            aria-label="Add five minutes to this session"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--border-2)",
              color: "var(--fg-2)",
              ...mono,
              fontSize: "11px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "12px 18px",
              minHeight: "44px",
              borderRadius: "16px",
              cursor: sessionFinished || showPostDistractionCapture || !isActive ? "default" : "pointer",
              opacity: sessionFinished || showPostDistractionCapture || !isActive ? 0.4 : 1,
            }}
          >
            +5 min
          </button>
        </div>
      )}

      <div
        data-session-chrome="secondary"
        data-visibility={sessionChromeDimmed ? "dimmed" : "visible"}
        style={{
          opacity: sessionChromeDimmed ? 0.32 : 1,
          transition: "opacity 0.5s ease",
          pointerEvents: "auto",
        }}
      >
        {!showPostDistractionCapture && (
          <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: isMobile ? "16px" : "32px", flexWrap: "wrap" }}>
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
                padding: "14px 24px",
                minHeight: "44px",
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
                padding: "14px 24px",
                minHeight: "44px",
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
                padding: "14px 24px",
                minHeight: "44px",
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
            marginTop: isMobile ? "8px" : "24px",
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
                padding: "12px 14px",
                minHeight: "44px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
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
