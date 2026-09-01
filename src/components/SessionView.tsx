"use client";

import { useState, useRef, useCallback, useEffect, type CSSProperties } from "react";
import { type SessionType, type Track } from "@/lib/constants";
import { sessionDurationForUser, type RecoveryFields } from "@/lib/duration";
import { BlockTimer } from "./BlockTimer";
import { ThoughtCapture } from "./ThoughtCapture";
import { FlashHint } from "./FlashHint";
import { useIsMobile } from "@/lib/useIsMobile";
import { loadSoundPrefs, saveSoundPrefs, unlockAudioContext, type SoundPrefs } from "@/lib/audio";
import { useVoiceCountdown } from "@/lib/useVoiceCountdown";
import { computeClearPercentFromLog } from "@/lib/mindStateSession";
import { useMindStateHold } from "@/lib/useMindStateHold";
import { markTrackingUnlockIfQualifying } from "@/lib/trackingControlPrefs";
import { useKeepScreenAwakePref, useWakeLock } from "@/lib/useWakeLock";
import {
  useHideDistractionHyperfocusControlsPref,
  useTrackingControlsUnlocked,
} from "@/lib/useTrackingControlPrefs";
import { useSessionSuppressionRelay } from "@/lib/useSessionSuppression";
import { saveMinimalSessionViewPref } from "@/lib/minimalSessionViewPrefs";
import { useMinimalSessionViewPref } from "@/lib/useMinimalSessionView";
import {
  MINIMAL_VIEW_LONG_PRESS_MS,
  beginMinimalViewPress,
  isPressPointer,
  pressMovedBeyondTolerance,
  resolveMinimalViewRelease,
  type MinimalViewPress,
} from "@/lib/minimalSessionGestures";
import {
  SOUND_TOGGLE_MIN_TAP_TARGET_PX,
  soundToggleAccessibilityLabel,
  soundToggleAppearance,
  soundToggleStateText,
  soundToggleTestId,
  type SoundToggleCue,
} from "@/lib/soundToggleAppearance";
import { GuidedExerciseOverlay } from "./GuidedExerciseOverlay";

type MindState = "clear" | "thinking" | "hyperfocus";

/**
 * #668: the speaker glyph inside a sound toggle. Inline SVG rather than a text
 * glyph so the on/off shapes are the same pair iOS draws with SF Symbols
 * (`speaker.wave.2.fill` / `speaker.slash.fill`) instead of whatever the device
 * font happens to have for `♪`.
 */
function SoundToggleIcon({
  muted,
  cue = "audio",
}: {
  muted: boolean;
  cue?: SoundToggleCue;
}) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      {cue === "haptic" ? (
        <>
          {/* #712: a phone throwing off waves reads as "this buzzes" where a
              speaker would read as "this makes a noise". Mirrors the iOS pair
              iphone.radiowaves.left.and.right / iphone.slash. */}
          <rect x="5.5" y="2" width="5" height="12" rx="1.25" />
          {muted ? (
            // Off: a slash across the phone.
            <path d="M3.5 13.5l9-11" />
          ) : (
            // On: waves leaving both sides.
            <>
              <path d="M3.25 5.75a4 4 0 000 4.5" />
              <path d="M12.75 5.75a4 4 0 010 4.5" />
            </>
          )}
        </>
      ) : (
        <>
          {/* Speaker body, shared by both states. */}
          <path d="M3 6h2l3-2.5v9L5 10H3z" fill="currentColor" stroke="none" />
          {muted ? (
            // Off: a slash through the waves.
            <path d="M10.5 6l4 4m0-4l-4 4" />
          ) : (
            // On: two sound waves, matching speaker.wave.2.fill.
            <>
              <path d="M10.5 5.75a3 3 0 010 4.5" />
              <path d="M12.75 4a5.5 5.5 0 010 8" />
            </>
          )}
        </>
      )}
    </svg>
  );
}

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
  fontFamily: "var(--font-mono)",
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
  useVoiceCountdown(soundPrefs.voiceCountdown);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True after user pauses once this sit — keeps tracking UI (and ThoughtCapture) mounted while paused. */
  const [wasPausedInSession, setWasPausedInSession] = useState(false);
  const [showGuidedExercise, setShowGuidedExercise] = useState(false);
  const guidedExerciseTriggerRef = useRef<HTMLButtonElement>(null);
  /**
   * #669: "just the timer". The persisted preference is the live source of truth,
   * so toggling both restyles this sit and is remembered for the next one.
   */
  const minimalView = useMinimalSessionViewPref();
  /** Keeps the screen-reader/keyboard escape hatch invisible until it is focused. */
  const [minimalExitFocused, setMinimalExitFocused] = useState(false);
  /** Live opt-in Settings pref; pause/complete/abandon drop `isActive` and toggle-off releases too. */
  const keepScreenAwakePref = useKeepScreenAwakePref();
  const trackingControlsUnlocked = useTrackingControlsUnlocked();
  const hideDistractionHyperfocusControls = useHideDistractionHyperfocusControlsPref();
  const showDistractionHyperfocusCluster =
    trackingControlsUnlocked && !hideDistractionHyperfocusControls;
  useWakeLock(keepScreenAwakePref && isActive);
  // Relay sit state to the service worker so it can suppress push display while
  // a sit is in progress when the opt-in pref is on (#431). Treat a paused sit
  // as still "in session" so reminders stay suppressed until it truly ends.
  useSessionSuppressionRelay(!sessionFinished);

  useEffect(() => {
    if (sessionFinished) {
      setShowGuidedExercise(false);
    }
  }, [sessionFinished]);

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
    enabled: isActive && showDistractionHyperfocusCluster && !showGuidedExercise,
    beginDistraction,
    beginHyperfocus,
    endHoldFromKeyboard,
  });

  const closeGuidedExercise = useCallback(() => {
    setShowGuidedExercise(false);
    requestAnimationFrame(() => guidedExerciseTriggerRef.current?.focus());
  }, []);

  const openGuidedExercise = useCallback(() => {
    finalizeActiveHold(elapsedRef.current);
    resetHoldTracking();
    setShowGuidedExercise(true);
  }, [finalizeActiveHold, resetHoldTracking]);

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
    markTrackingUnlockIfQualifying({ duration: plannedSeconds, completed: true });
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

  /** Stable so the minimal-view long press can depend on it without re-subscribing. */
  const handleOpenThoughtCapture = useCallback(() => {
    finalizeActiveHold(elapsedRef.current);
    setShowPostDistractionCapture(true);
  }, [finalizeActiveHold]);

  const exitMinimalView = useCallback(() => {
    // The exit button unmounts with minimal view, so its `onBlur` may never fire.
    // Left set, the next entry into minimal view would render the button in its
    // visible state — new chrome on a screen that is meant to be just the timer.
    setMinimalExitFocused(false);
    saveMinimalSessionViewPref(false);
  }, []);

  const enterMinimalView = useCallback(() => {
    finalizeActiveHold(elapsedRef.current);
    resetHoldTracking();
    saveMinimalSessionViewPref(true);
  }, [finalizeActiveHold, resetHoldTracking]);

  /**
   * #669: while minimal, the whole screen is the affordance — a tap restores the
   * full session screen, a long press opens thought capture *without* leaving
   * minimal view, and a drag (scroll) does neither. Escape also restores, for
   * keyboard users who cannot long-press.
   *
   * The tap and the capture gesture never collide: tap-anywhere is not a capture
   * gesture in the full view either, so capture keeps its own distinct gesture.
   */
  useEffect(() => {
    if (!minimalView || sessionFinished || showPostDistractionCapture || showGuidedExercise) return;

    let press: MinimalViewPress | null = null;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

    const clearLongPressTimer = () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = null;
    };

    const onPointerDown = (e: PointerEvent) => {
      // Right/middle click opens a context menu — it must not drop the sit out of
      // minimal view. Touch and pen both report button 0 here.
      if (e.button !== 0) return;
      // First finger down owns the gesture; a second one is ignored until it ends.
      if (press) return;
      press = beginMinimalViewPress(e.pointerId, e.clientX, e.clientY);
      clearLongPressTimer();
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (!press || press.consumed) return;
        press.consumed = true;
        handleOpenThoughtCapture();
      }, MINIMAL_VIEW_LONG_PRESS_MS);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!press || press.consumed || !isPressPointer(press, e.pointerId)) return;
      if (pressMovedBeyondTolerance(press, e.clientX, e.clientY)) {
        press.consumed = true;
        clearLongPressTimer();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      // Same mouse pointer id carries every button; only the one that opened the
      // press resolves it.
      if (e.button !== 0) return;
      if (!isPressPointer(press, e.pointerId)) return;
      clearLongPressTimer();
      const action = resolveMinimalViewRelease(press);
      press = null;
      if (action === "exit") exitMinimalView();
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (!isPressPointer(press, e.pointerId)) return;
      clearLongPressTimer();
      press = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitMinimalView();
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearLongPressTimer();
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    minimalView,
    sessionFinished,
    showPostDistractionCapture,
    showGuidedExercise,
    exitMinimalView,
    handleOpenThoughtCapture,
  ]);

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
  const showSessionTrackingLayer = (isActive || wasPausedInSession) && !minimalView;
  /** Off-screen until focused: the keyboard/screen-reader way out of minimal view. */
  const minimalExitButtonStyle: CSSProperties = minimalExitFocused
    ? {
        position: "fixed",
        top: "12px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        background: "var(--surface-1)",
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
      }
    : {
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap",
        border: 0,
        background: "none",
      };
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
    <div
      data-session-view-mode={minimalView ? "minimal" : "full"}
      style={{
        animation: "fadeIn 0.8s ease",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        // Minimal view drops every row below the countdown, so centre what is left.
        ...(minimalView ? { justifyContent: "center", minHeight: "60vh" } : null),
      }}
    >
      <GuidedExerciseOverlay open={showGuidedExercise} onClose={closeGuidedExercise} />
      <BlockTimer
        totalSeconds={totalSeconds}
        isActive={isActive}
        onComplete={handleComplete}
        mindState={mindState}
        mindStateLog={mindStateLog}
        onElapsedChange={handleElapsedChange}
        soundPrefs={soundPrefs}
        minimal={minimalView}
      />

      {minimalView && (
        <button
          type="button"
          data-minimal-view-exit
          onClick={exitMinimalView}
          onFocus={() => setMinimalExitFocused(true)}
          onBlur={() => setMinimalExitFocused(false)}
          style={minimalExitButtonStyle}
        >
          show session controls
        </button>
      )}

      {minimalView && !showPostDistractionCapture && (
        <FlashHint style={{ marginTop: "24px", width: "100%" }}>
          <p
            data-minimal-view-hint
            style={{
              margin: 0,
              textAlign: "center",
              ...mono,
              fontSize: "10px",
              color: "var(--fg-4)",
              letterSpacing: "0.08em",
              lineHeight: 1.5,
              padding: "0 20px",
            }}
          >
            {isMobile
              ? "Tap anywhere to bring the session back · press and hold to capture a note"
              : "Tap anywhere or press Esc to bring the session back · press and hold to capture a note"}
          </p>
        </FlashHint>
      )}

      {minimalView && showPostDistractionCapture && (
        <div
          data-no-space-distraction
          style={{ marginTop: "28px", width: "100%", display: "flex", justifyContent: "center" }}
        >
          <ThoughtCapture onSave={handleSaveThought} onCancel={handleDismissPostCapture} />
        </div>
      )}

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

          {!trackingControlsUnlocked && (
            <p
              data-tracking-unlock-explainer
              style={{
                margin: "16px 0 0",
                textAlign: "center",
                ...mono,
                fontSize: "10px",
                color: "var(--fg-4)",
                letterSpacing: "0.05em",
                lineHeight: 1.5,
              }}
            >
              Distraction and hyperfocus tracking unlock after you complete one sit of five minutes or longer.
            </p>
          )}

          {showDistractionHyperfocusCluster && (
            <>
              <div
                data-tracking-controls="visible"
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
            </>
          )}

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
            <div
              style={{
                marginTop: isMobile ? "12px" : "18px",
                display: "flex",
                justifyContent: "center",
                gap: "10px",
                flexWrap: "wrap",
                width: "100%",
              }}
            >
              {isActive && (
                <button
                  ref={guidedExerciseTriggerRef}
                  type="button"
                  onClick={openGuidedExercise}
                  aria-label="Open guided exercise"
                  data-testid="guided-exercise-open"
                  style={{
                    ...captureNoteButtonStyle,
                    borderColor: "var(--accent-green-border-subtle)",
                    color: "var(--accent-green-dim)",
                    opacity: sessionChromeDimmed ? 0.48 : 0.88,
                  }}
                >
                  guided exercise
                </button>
              )}
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
              <button
                type="button"
                onClick={enterMinimalView}
                aria-label="Show only the timer"
                data-minimal-view-enter
                style={{
                  ...captureNoteButtonStyle,
                  borderColor: "var(--border-2)",
                  color: "var(--fg-3)",
                  opacity: sessionChromeDimmed ? 0.48 : 0.88,
                }}
              >
                just the timer
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

      {!sessionFinished && !showPostDistractionCapture && !minimalView && (
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

      {!minimalView && (
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

        {/*
          #668: real pill buttons, not four bare words. On/off is carried by fill,
          border, and the speaker icon together \u2014 the same three channels iOS uses
          via `SoundToggleAppearance` \u2014 so the state reads at a glance rather than
          resting on a shift between two muted greys. `flexWrap` is a safety net:
          the row is sized to fit four pills at 320px, and an unusually wide font
          drops to a second line instead of being clipped by `overflow-x: hidden`.
        */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: "6px",
            marginTop: isMobile ? "8px" : "24px",
            ...mono,
            fontSize: "10px",
            letterSpacing: "0.06em",
          }}
        >
          {(
            [
              ["tick", "tick", "audio"],
              ["chime", "chime", "audio"],
              ["voiceCountdown", "voice", "audio"],
              ["completion", "end", "audio"],
              // #712: vibration rather than sound, so it carries its own cue.
              ["haptics", "haptics", "haptic"],
            ] as const
          ).map(([key, label, cue]) => {
            const isOn = soundPrefs[key];
            const appearance = soundToggleAppearance(isOn, cue);
            return (
              <button
                type="button"
                key={key}
                // Native button + aria-pressed: assistive tech announces
                // "tick sound, toggle button, pressed" and re-announces on change,
                // so the state never depends on seeing the fill.
                aria-pressed={isOn}
                aria-label={soundToggleAccessibilityLabel(label, cue)}
                // Becomes the accessible *description*, not the name. Deliberately
                // restates the state in words: it is the hover tooltip for mouse
                // users, and a plain-language fallback on the older
                // browser/screen-reader pairs that handle `aria-pressed` poorly.
                title={`${soundToggleAccessibilityLabel(label, cue)} \u2014 ${soundToggleStateText(isOn)}`}
                data-testid={soundToggleTestId(label)}
                data-sound-toggle={label}
                data-state={soundToggleStateText(isOn)}
                onClick={() => {
                  const next = { ...soundPrefs, [key]: !soundPrefs[key] };
                  setSoundPrefs(next);
                  saveSoundPrefs(next);
                  // #712: haptics is the one toggle that must not unlock the
                  // audio context. It exists for someone who wants silence, and
                  // vibration needs no audio context at all.
                  if (next[key] && cue !== "haptic") {
                    void unlockAudioContext();
                  }
                }}
                style={{
                  background: appearance.isFilled ? "var(--surface-3)" : "transparent",
                  border: `1px solid ${
                    appearance.hasProminentBorder ? "var(--border-2)" : "var(--border-1)"
                  }`,
                  cursor: "pointer",
                  color: isOn ? "var(--fg-2)" : "var(--fg-4)",
                  transition: "background 0.2s, border-color 0.2s, color 0.2s",
                  // Padding plus this min-height makes the *visible* pill the tap
                  // target, rather than a small glyph inside an invisible one.
                  padding: "0 10px",
                  minHeight: `${SOUND_TOGGLE_MIN_TAP_TARGET_PX}px`,
                  borderRadius: `${SOUND_TOGGLE_MIN_TAP_TARGET_PX / 2}px`,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "5px",
                  whiteSpace: "nowrap",
                }}
              >
                <SoundToggleIcon muted={appearance.isIconMuted} cue={cue} />
                {label}
              </button>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}
