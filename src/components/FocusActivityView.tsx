"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadSoundPrefs, unlockAudioContext } from "@/lib/audio";
import {
  focusCountdownFontSize,
  focusRemainingSeconds,
  formatFocusCountdown,
  formatFocusGoal,
  resolveFocusEnd,
  type FocusEndReason,
  type FocusSessionResult,
} from "@/lib/focusActivity";
import { useSessionCues } from "@/lib/useSessionCues";
import { useSessionSuppressionRelay } from "@/lib/useSessionSuppression";
import { useKeepScreenAwakePref, useWakeLock } from "@/lib/useWakeLock";

type FocusActivityViewProps = {
  /** The goal in seconds. Read once, when the view opens. */
  goalSeconds: number;
  /** Called exactly once: `completed: true` when the countdown reaches zero,
   *  `completed: false` when End is pressed before it does. `null` when End
   *  comes before a whole second has passed, so there is nothing to save. The
   *  parent persists the session and closes the view. */
  onEnd: (result: FocusSessionResult | null) => void;
};

/**
 * Call from the tap that opens the focus timer, inside that gesture (#836).
 * The completion sound plays when the goal is reached, up to two hours after
 * the tap, and a strict-autoplay browser (iOS Safari) only plays from an audio
 * context a gesture unlocked. Skipped when the completion sound is off, so a
 * silent setup never warms an audio session.
 */
export function unlockFocusCompletionAudio(): void {
  if (loadSoundPrefs().completion) void unlockAudioContext();
}

/**
 * #836 — the focus activity timer: a full-screen countdown to the focus goal,
 * modeled on `BreathCountView`. It runs silently (no tick, minute chime, voice
 * countdown or interval buzz), because a focus session is for reading, writing
 * or listening. Only a countdown that runs out is announced, through the
 * person's own completion-sound and haptic settings.
 */
export function FocusActivityView({ goalSeconds, onEnd }: FocusActivityViewProps) {
  // Pinned when the view opens: a user refresh mid-session (a sync landing,
  // say) must not move the goal the person is already counting down to.
  const [goal] = useState(goalSeconds);
  // The Home tap is the start gesture, so the session starts on mount.
  const startMsRef = useRef(Date.now());
  const [remaining, setRemaining] = useState(goal);
  const [running, setRunning] = useState(true);
  // Re-entrancy guard so expiry and End (or two End clicks) landing in the same
  // frame can't double-report. Mirrors `BreathCountView`.
  const endedRef = useRef(false);
  // Read through a ref so a new parent callback (the user object changed) never
  // restarts the countdown.
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // Only `end()` is ever called. The running cues are planned by `advance()`,
  // which this view never calls, so the session is silent by construction.
  const [soundPrefs] = useState(() => loadSoundPrefs());
  // `isActive` keeps the audio context resumed while the timer runs. Only the
  // completion sound needs it (the end haptic never touches audio), so with that
  // sound off a context left by an earlier sit stays suspended, as
  // `unlockFocusCompletionAudio` leaves it unopened.
  const cues = useSessionCues({ isActive: running && soundPrefs.completion, soundPrefs });

  // Wake lock parity with sits (#317): keep the screen awake while it runs.
  const keepAwakePref = useKeepScreenAwakePref();
  useWakeLock(keepAwakePref && running);
  // One key for this mount, so ending releases only this session's hold (#741).
  const notificationSessionKeyRef = useRef(crypto.randomUUID());
  // Hold Still Point's own notifications while it runs, as a sit does (#431 / #709).
  useSessionSuppressionRelay(running, notificationSessionKeyRef.current);

  const finish = useCallback((reason: FocusEndReason) => {
    if (endedRef.current) return;
    endedRef.current = true;
    setRunning(false);
    // Pressing End is its own signal; only a countdown that ran out is announced.
    if (reason === "expired") cues.end();
    onEndRef.current(resolveFocusEnd({
      startMs: startMsRef.current,
      nowMs: Date.now(),
      goalSeconds: goal,
      reason,
    }));
  }, [goal, cues]);

  // Wall-clock countdown, as in `BreathCountView`: a backgrounded tab catches
  // up on its next tick instead of drifting.
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const left = focusRemainingSeconds(startMsRef.current, Date.now(), goal);
      setRemaining(left);
      if (left === 0) finish("expired");
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [running, goal, finish]);

  const reachedGoal = remaining === 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgb(var(--bg-rgb))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--s4)",
        fontFamily: "var(--font-mono)",
        padding: "var(--s4)",
        animation: "fadeIn 0.6s ease",
      }}
    >
      <div
        role="timer"
        aria-label="Focus time remaining"
        data-testid="focus-remaining"
        style={{
          fontSize: focusCountdownFontSize(goal),
          fontWeight: 200,
          lineHeight: 1,
          color: reachedGoal ? "var(--accent-green)" : "var(--fg)",
          textShadow: reachedGoal ? "0 0 40px var(--accent-green-glow)" : "none",
          transition: "color 0.8s, text-shadow 0.8s",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {formatFocusCountdown(remaining)}
      </div>

      <div
        data-testid="focus-goal"
        style={{
          fontSize: "13px",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "var(--fg-3)",
        }}
      >
        focus &middot; {formatFocusGoal(goal)}
      </div>

      {/* End — explicit, pinned near the bottom, as in `BreathCountView`. */}
      <button
        type="button"
        onClick={() => finish("ended")}
        style={{
          position: "absolute",
          bottom: "calc(var(--s5) + env(safe-area-inset-bottom, 0px))",
          left: "50%",
          transform: "translateX(-50%)",
          background: "var(--surface-1)",
          border: "1px solid var(--border-1)",
          color: "var(--fg-3)",
          borderRadius: "999px",
          padding: "12px 32px",
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          fontWeight: 500,
          letterSpacing: "0.08em",
          cursor: "pointer",
        }}
        aria-label="End focus session"
      >
        End
      </button>
    </div>
  );
}
