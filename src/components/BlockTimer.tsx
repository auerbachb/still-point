"use client";

import { useState, useEffect, useRef } from "react";
import { BLOCK_DURATION } from "@/lib/constants";
import { MindStateBar } from "./MindStateBar";
import { playTick, playChime, playCompletion, playVoiceCountdown, cancelVoiceCountdownPlayback, resumeAudioContext, type SoundPrefs } from "@/lib/audio";
import { maybeFireHaptic } from "@/lib/haptics";
import { loadDisplayPrefs, saveDisplayPrefs } from "@/lib/displayPrefs";
import { useIsMobile } from "@/lib/useIsMobile";
import { useAudioContextResume } from "@/lib/useAudioContextResume";

type BlockTimerProps = {
  totalSeconds: number;
  onComplete: () => void;
  isActive: boolean;
  mindState: string;
  mindStateLog: Array<{ time: number; state: string }>;
  onElapsedChange?: (elapsed: number) => void;
  onSoundPlaybackBlocked?: () => void;
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
  /**
   * #669 "just the timer": render the numeric countdown alone — no mind-state bar,
   * progress bar, block grid, or show/hide toggle. The clock, sounds, and
   * completion callback are unaffected, so the sit runs exactly as it does in the
   * full view.
   */
  minimal?: boolean;
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
  onSoundPlaybackBlocked,
  soundPrefs,
  controlledElapsed,
  syncClock,
  minimal = false,
}: BlockTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pausedElapsedRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onSoundPlaybackBlockedRef = useRef(onSoundPlaybackBlocked);
  onSoundPlaybackBlockedRef.current = onSoundPlaybackBlocked;
  const soundPrefsRef = useRef(soundPrefs);
  soundPrefsRef.current = soundPrefs;
  const lastTickSecRef = useRef(-1);
  const lastVoiceSecRef = useRef(61);
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

  useEffect(() => {
    if (!isActive) cancelVoiceCountdownPlayback();
    return () => cancelVoiceCountdownPlayback();
  }, [isActive]);

  // #710: recovers a context the browser suspended while the tab was hidden or
  // the screen was locked — the sound used to stay off for the rest of the sit.
  useAudioContextResume(isActive);

  const resumeInFlightRef = useRef(false);
  /// The most recent sound that failed to play, replayed once the context
  /// recovers. Only the latest is kept: these closures are different sounds
  /// (`playTick`, `playCompletion`, a voice prompt bound to a specific second),
  /// so replaying an older one would emit the wrong sound — announcing "three"
  /// after the sit has already ended.
  const pendingPlayRef = useRef<(() => boolean) | null>(null);
  /// Guards the async blocked-report below. Reporting used to be synchronous,
  /// so it could not outlive the timer; the resume attempt introduced a gap the
  /// sit can end inside. The consumer of onSoundPlaybackBlocked lives in
  /// BuddySessionRoom, which outlives this component, so an unguarded late
  /// report is not a harmless no-op — it raises "Browser audio is paused" over
  /// a session that already ended.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const playEnabledSound = (play: () => boolean) => {
    if (play()) return;

    // #710: a sound can also start failing without a visibility change (the
    // browser suspending the context on its own). Try to resume before falling
    // back to the gesture-driven affordance, so the sound that failed — and any
    // that fail while the attempt is in flight — are not simply lost.
    //
    // The blocked callback only fires once that attempt has failed: nothing
    // clears `audioBlocked` on a successful resume, so reporting it up front
    // would leave "Browser audio is paused" on screen for a session whose sound
    // recovered on its own. A play that fails while an attempt is already in
    // flight is covered by that attempt's result.
    pendingPlayRef.current = play;
    if (resumeInFlightRef.current) return;
    resumeInFlightRef.current = true;
    void resumeAudioContext()
      .then(resumed => {
        // Replay the sound that triggered the resume. Waiting for the next
        // scheduled sound only works for the repeating tick — a completion
        // chime or a voice countdown prompt has no successor, so dropping it
        // loses it outright.
        const retry = pendingPlayRef.current;
        pendingPlayRef.current = null;
        if (resumed && retry?.()) return;
        // The retry itself is deliberately not gated on the timer still being
        // active: a completion chime that failed is retried as the sit ends,
        // which is exactly when it is wanted. Only the banner is suppressed.
        if (!mountedRef.current) return;
        onSoundPlaybackBlockedRef.current?.();
      })
      .finally(() => {
        resumeInFlightRef.current = false;
      });
  };

  /**
   * Everything the end of a sit announces, in both channels.
   *
   * The three timer paths below — local, buddy `syncClock`, and controlled —
   * each reach the end of a sit separately and all three owe the same cues, so
   * they share one function rather than three copies that drift.
   *
   * #712: the buzz is deliberately not gated on `completion`. Silencing the
   * bell must not silence the buzz — that is the whole reason the preference
   * exists. It is also not routed through `playEnabledSound`: the "browser audio
   * is paused" affordance is about the audio context, which vibration never
   * touches. Reached only when the timer actually ran out, so it needs no
   * abandon or end-early guard — a discarded sit never gets here.
   */
  const playSessionEndCues = () => {
    maybeFireHaptic(soundPrefsRef.current?.haptics, "sessionEnd");
    if (soundPrefsRef.current?.completion) playEnabledSound(playCompletion);
  };

  const maybePlayCountdownSounds = (newElapsed: number) => {
    const prefs = soundPrefsRef.current;
    if (!prefs) return;

    const remaining = totalSeconds - newElapsed;
    const voiceMode = Boolean(prefs.voiceCountdown);
    const currentSec = Math.floor(newElapsed);

    if (voiceMode) {
      if (remaining > 60) {
        if (lastVoiceSecRef.current <= 60) {
          cancelVoiceCountdownPlayback();
          lastVoiceSecRef.current = 61;
        }
      } else if (remaining > 0) {
        let announceSec = Math.floor(remaining);
        if (announceSec < 1) announceSec = 1;
        if (remaining > 59 && lastVoiceSecRef.current > 60) {
          announceSec = 60;
        }
        if (announceSec !== lastVoiceSecRef.current) {
          lastVoiceSecRef.current = announceSec;
          playEnabledSound(() => playVoiceCountdown(announceSec));
        }
      }
    } else if (prefs.tick && currentSec > lastTickSecRef.current) {
      lastTickSecRef.current = currentSec;
      playEnabledSound(playTick);
    }

    if (useMinuteBlocks) {
      const completedBlockIndex = Math.min(
        minuteBlockCount - 1,
        Math.floor(newElapsed / 60) - 1,
      );

      if (completedBlockIndex > lastCompletedBlockIndexRef.current) {
        lastCompletedBlockIndexRef.current = completedBlockIndex;

        const blockEnd = (completedBlockIndex + 1) * 60;
        // Unchanged rule for *when* the marker fires: only on a completed
        // minute block with at least one full minute still to go. Since #711
        // the count no longer sets how many strikes play — the bell is one
        // strike — so it survives purely as that gate. Hoisted out of the chime
        // branch by #712 so the buzz can share it: one timing source, two
        // channels, marking the same instants.
        const fullMinuteRemains =
          Math.floor((totalSeconds - blockEnd) / 60) >= 1;

        if (prefs.chime && !voiceMode && fullMinuteRemains) {
          playEnabledSound(playChime);
        }

        // #712: read from neither `prefs.chime` nor `voiceMode`, so a sitter who
        // turned every sound off still feels each minute go by. Never routed
        // through `playEnabledSound` — the "browser audio is paused" affordance
        // is about the audio context, which vibration does not touch.
        if (fullMinuteRemains) {
          maybeFireHaptic(prefs.haptics, "minuteMarker");
        }
      }
    }
  };

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
    const isResume =
      resumeElapsed < totalSeconds &&
      (resumeElapsed > 0 || startTimeRef.current !== null);

    if (isResume) {
      lastTickSecRef.current = Math.floor(resumeElapsed);
      lastVoiceSecRef.current =
        totalSeconds - resumeElapsed <= 60
          ? Math.floor(totalSeconds - resumeElapsed)
          : 61;
      lastCompletedBlockIndexRef.current = useMinuteBlocks
        ? Math.min(minuteBlockCount - 1, Math.floor(resumeElapsed / 60) - 1)
        : -1;
    } else {
      // Fresh session — clear all accumulated state
      lastCompletedBlockIndexRef.current = -1;
      lastTickSecRef.current = -1;
      lastVoiceSecRef.current = 61;
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
          playSessionEndCues();
          onCompleteRef.current();
        } else {
          setElapsed(newElapsed);
          pausedElapsedRef.current = newElapsed;
          maybePlayCountdownSounds(newElapsed);
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
    lastVoiceSecRef.current =
      duration - seed <= 60 ? Math.floor(duration - seed) : 61;
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
          playSessionEndCues();
          onCompleteRef.current();
        }
        return;
      }

      setElapsed(newElapsed);
      pausedElapsedRef.current = newElapsed;
      maybePlayCountdownSounds(newElapsed);
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
        playSessionEndCues();
        onCompleteRef.current();
      }
      return;
    }

    setElapsed(newElapsed);
    pausedElapsedRef.current = newElapsed;
    // Back below the end means a fresh run on the same mounted timer, so re-arm
    // the completion latch the way the buddy-sync path re-arms it on seed.
    // Without this a second controlled run would find the latch still set and
    // silently skip its end haptic and completion cue.
    controlledCompleteFiredRef.current = false;
    const remainingNow = totalSeconds - newElapsed;
    lastVoiceSecRef.current =
      remainingNow > 60 ? 61 : Math.max(lastVoiceSecRef.current, Math.floor(remainingNow));
    maybePlayCountdownSounds(newElapsed);
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
