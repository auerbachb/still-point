"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { combinedDurationForUser, combinedSitField } from "@/lib/combinedSit";
import { type SessionType, type Track } from "@/lib/constants";
import { sessionDurationForUser, type RecoveryFields } from "@/lib/duration";
import { BlockTimer } from "./BlockTimer";
import { ThoughtCapture } from "./ThoughtCapture";
import { FlashHint } from "./FlashHint";
import { useIsMobile } from "@/lib/useIsMobile";
import { useAudioUnlock } from "@/lib/useAudioUnlock";
import { AudioBlockedBanner } from "./AudioBlockedBanner";
import { computeClearPercentFromLog } from "@/lib/mindStateSession";
import { useMindStateHold } from "@/lib/useMindStateHold";
import { markTrackingUnlockIfQualifying } from "@/lib/trackingControlPrefs";
import { useKeepScreenAwakePref, useWakeLock } from "@/lib/useWakeLock";
import {
  useHideDistractionHyperfocusControlsPref,
  useTrackingControlsUnlocked,
} from "@/lib/useTrackingControlPrefs";
import { useSessionSuppressionRelay } from "@/lib/useSessionSuppression";
import { canTogglePause } from "@/lib/sessionPauseToggle";
import { canEndSession } from "@/lib/sessionEndGuard";
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
import { GuidedExerciseOverlay } from "./GuidedExerciseOverlay";
import { SessionActionRow } from "./session/SessionActionRow";
import { SessionEndControls } from "./session/SessionEndControls";
import { SessionExtendButtons } from "./session/SessionExtendButtons";
import { SessionHoldControls } from "./session/SessionHoldControls";
import { SessionMindStateStatus, type SessionMindState } from "./session/SessionMindStateStatus";
import { SessionSoundControls } from "./session/SessionSoundControls";
import { minimalExitButtonStyle, mono } from "./session/sessionViewStyles";

type MindState = SessionMindState;

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
  /** #769: today's two sits done as one. The caller runs it as a standard sit
   *  on the primary track, with the primary day as `currentDay`. */
  combined?: boolean;
  /** #769: Track Two's day, which a combined sit's planned length adds in. */
  secondTrackDay?: number;
  onComplete: (data: {
    /** #930: one per mount, the same on every way out of this sit. */
    sitKey: string;
    dayNumber: number;
    sessionType: SessionType;
    track: Track;
    /** #769: present, and true, only for a combined sit. */
    combined?: boolean;
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
    /** #930: one per mount, the same on every way out of this sit. */
    sitKey: string;
    dayNumber: number;
    sessionType: SessionType;
    track: Track;
    /** #769: present, and true, only for a combined sit. */
    combined?: boolean;
    duration: number;
    bonusSeconds: number;
    completed: boolean;
    actualTime: number;
    clearPercent: number;
    thoughtCount: number;
    mindStateLog: Array<{ time: number; state: string }>;
    thoughts: Array<{ timeInSession: number; text: string }>;
  }) => void;
  /** #988: this sit's screen went away (browser Back, a tab change, its own
   *  save closing it). Called once, on unmount, with the sit's `sitKey`, so a
   *  save still running for it knows not to change the screen when it settles. */
  onScreenClosed?: (sitKey: string) => void;
};

export function SessionView({
  currentDay,
  recovery = NO_RECOVERY,
  sessionType = "standard",
  track = "primary",
  combined = false,
  secondTrackDay = 1,
  onComplete,
  onAbandon,
  onScreenClosed,
}: SessionViewProps) {
  const isMobile = useIsMobile();
  // #769: a combined sit is one sit as long as both tracks' sits together.
  // Bonus time, pause and the tracking unlock all work from this, as for any sit.
  const plannedSeconds = combined
    ? combinedDurationForUser(currentDay, secondTrackDay)
    : sessionDurationForUser(sessionType, currentDay, recovery);
  const [bonusSeconds, setBonusSeconds] = useState(0);
  const totalSeconds = plannedSeconds + bonusSeconds;
  const [sessionFinished, setSessionFinished] = useState(false);
  // #930: `sessionFinished` for the terminal handlers, set the moment one of
  // them claims the sit. Clicks that land before React re-renders all read the
  // state as false, and each would save another sit.
  const sessionFinishedRef = useRef(false);
  // #930: which sit this is. Sent on every way out of it, so the save hook can
  // refuse a second save of the same sit.
  const sitKeyRef = useRef(crypto.randomUUID());
  // #988: report the screen closing on unmount only. Read through a ref so a
  // new callback from the parent never runs the cleanup — and reports the sit
  // closed — while its screen is still open.
  const onScreenClosedRef = useRef(onScreenClosed);
  onScreenClosedRef.current = onScreenClosed;
  useEffect(() => {
    const sitKey = sitKeyRef.current;
    return () => {
      onScreenClosedRef.current?.(sitKey);
    };
  }, []);
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
  const {
    soundPrefs,
    audioBlocked,
    handleSoundPlaybackBlocked,
    handleSoundPlaybackResumed,
    handleSoundPrefToggle,
    setCueMode,
    setHapticInterval,
    handleEnableLocalAudio,
  } = useAudioUnlock("solo");
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
  // One key for this mount, so ending the sit releases only this sit's hold (#741).
  const notificationSessionKeyRef = useRef(crypto.randomUUID());
  // Relay sit state to the service worker so it can suppress push display while
  // a sit is in progress when the opt-in pref is on (#431). Treat a paused sit
  // as still "in session" so reminders stay suppressed until it truly ends.
  useSessionSuppressionRelay(!sessionFinished, notificationSessionKeyRef.current);

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

  /**
   * #930: claims the sit for the first way out of it (it ran out, End Early,
   * or Abandon), before that handler changes anything. Returns false once the
   * sit is claimed, and the handler then does nothing.
   */
  const claimSessionEnd = useCallback(() => {
    if (!canEndSession({ sessionFinished: sessionFinishedRef.current })) return false;
    sessionFinishedRef.current = true;
    return true;
  }, []);

  const handleComplete = useCallback(() => {
    if (!claimSessionEnd()) return;
    const resolvedLog = snapshotForComplete();
    setWasPausedInSession(false);
    setSessionFinished(true);
    setIsActive(false);
    const actualTime = Math.round((Date.now() - wallStartRef.current) / 1000);
    const endT = elapsedRef.current || totalSeconds;
    markTrackingUnlockIfQualifying({ duration: plannedSeconds, completed: true });
    onComplete({
      sitKey: sitKeyRef.current,
      dayNumber: currentDay,
      sessionType,
      track,
      ...combinedSitField(combined),
      duration: plannedSeconds,
      bonusSeconds,
      completed: true,
      actualTime,
      clearPercent: computeClearPercentFromLog(resolvedLog, endT),
      thoughtCount: payloadThoughtCount(),
      mindStateLog: resolvedLog,
      thoughts: sessionThoughtsRef.current,
    });
  }, [currentDay, sessionType, track, combined, plannedSeconds, bonusSeconds, totalSeconds, onComplete, snapshotForComplete, claimSessionEnd]);

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
    if (!claimSessionEnd()) return;
    const resolvedLog = snapshotForComplete();
    setWasPausedInSession(false);
    setSessionFinished(true);
    setIsActive(false);
    const actualTime = Math.round((Date.now() - wallStartRef.current) / 1000);
    const endT = elapsedRef.current || totalSeconds;
    onComplete({
      sitKey: sitKeyRef.current,
      dayNumber: currentDay,
      sessionType,
      track,
      ...combinedSitField(combined),
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
    if (!claimSessionEnd()) return;
    const resolvedLog = snapshotForComplete();
    setWasPausedInSession(false);
    setSessionFinished(true);
    setIsActive(false);
    const actualTime = Math.round((Date.now() - wallStartRef.current) / 1000);
    const endT = elapsedRef.current || totalSeconds;
    onAbandon({
      sitKey: sitKeyRef.current,
      dayNumber: currentDay,
      sessionType,
      track,
      ...combinedSitField(combined),
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

  // #884: a sit that has ended stays on screen while its save settles, and
  // neither Pause nor Resume applies to it, as on iOS (#848).
  const pauseToggleEnabled = canTogglePause({ sessionFinished });
  // #930: nor End Early or Abandon, which would save it a second time.
  const endEnabled = canEndSession({ sessionFinished });

  const togglePause = () => {
    // First, before anything changes: a Resume here would set `isActive` again
    // and start the clock and cues back up.
    if (!pauseToggleEnabled) return;
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
  const capturedCount = sessionThoughts.length;
  const sessionChromeDimmed = isActive && !controlsVisible;
  const showSessionTrackingLayer = (isActive || wasPausedInSession) && !minimalView;

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
        onSoundPlaybackBlocked={handleSoundPlaybackBlocked}
        onSoundPlaybackResumed={handleSoundPlaybackResumed}
        minimal={minimalView}
      />

      {minimalView && (
        <button
          type="button"
          data-minimal-view-exit
          onClick={exitMinimalView}
          onFocus={() => setMinimalExitFocused(true)}
          onBlur={() => setMinimalExitFocused(false)}
          style={minimalExitButtonStyle(minimalExitFocused)}
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
          <SessionMindStateStatus
            mindState={mindState}
            distractionSegmentCount={distractionSegmentCount}
            capturedCount={capturedCount}
          />

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
            <SessionHoldControls
              isActive={isActive}
              isMobile={isMobile}
              mindState={mindState}
              mindStateRef={mindStateRef}
              holdKindRef={holdKindRef}
              onDistractionDown={handlePointerDistractionDown}
              onDistractionUp={handlePointerDistractionUp}
              onHyperfocusDown={handlePointerHyperfocusDown}
              onHyperfocusUp={handlePointerHyperfocusUp}
            />
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
            <SessionActionRow
              isActive={isActive}
              isMobile={isMobile}
              dimmed={sessionChromeDimmed}
              guidedExerciseTriggerRef={guidedExerciseTriggerRef}
              onOpenGuidedExercise={openGuidedExercise}
              onOpenThoughtCapture={handleOpenThoughtCapture}
              onEnterMinimalView={enterMinimalView}
            />
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
        <SessionExtendButtons
          isMobile={isMobile}
          disabled={sessionFinished || showPostDistractionCapture || !isActive}
          onExtend={extendSessionSeconds}
        />
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
          <SessionEndControls
            isMobile={isMobile}
            isActive={isActive}
            pauseToggleEnabled={pauseToggleEnabled}
            endEnabled={endEnabled}
            onTogglePause={togglePause}
            onEndEarly={handleEndEarly}
            onAbandon={handleAbandon}
          />
        )}

        {audioBlocked && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: isMobile ? "12px" : "20px" }}>
            <AudioBlockedBanner onEnableLocalAudio={() => void handleEnableLocalAudio()} />
          </div>
        )}

        <SessionSoundControls
          isMobile={isMobile}
          soundPrefs={soundPrefs}
          setCueMode={setCueMode}
          setHapticInterval={setHapticInterval}
          onSoundPrefToggle={handleSoundPrefToggle}
        />
      </div>
      )}
    </div>
  );
}
