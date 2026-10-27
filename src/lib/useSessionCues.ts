"use client";

import { useEffect, useRef, useState } from "react";
import {
  cancelVoiceCountdownPlayback,
  playChime,
  playCompletion,
  playTick,
  playVoiceCountdown,
  resumeAudioContext,
  type SoundPrefs,
} from "@/lib/audio";
import { maybeFireHaptic } from "@/lib/haptics";
import {
  INITIAL_CUE_CURSOR,
  followControlledVoice,
  freshCueCursor,
  planCountdownCues,
  planSessionEndCues,
  rewoundCueCursor,
  seededCueCursor,
  type Cue,
  type CueCursor,
} from "@/lib/sessionCues";
import { useAudioContextResume } from "@/lib/useAudioContextResume";

/**
 * What a session clock tells the cues. Stable for the life of the timer, and
 * every method reads the latest preferences and callbacks, so a clock may call
 * it from an interval set up on an earlier render.
 */
export type SessionCues = {
  /** A sit starting from zero: forget every cue already played. */
  reset(): void;
  /** A sit picked up at `elapsed` (a resume, or a synced join): cues before it count as played. */
  seed(elapsed: number, totalSeconds: number): void;
  /** A parent-controlled elapsed moved backwards: re-arm the cues for the new run. */
  rewind(elapsed: number, totalSeconds: number): void;
  /** The clock reached `elapsed`, short of the end: play whatever is now due. */
  advance(elapsed: number, totalSeconds: number): void;
  /** {@link advance} for a parent-controlled elapsed, which keeps its own voice rule. */
  advanceControlled(elapsed: number, totalSeconds: number): void;
  /** The sit ran its full length: play the end-of-sit cues. */
  end(): void;
};

type UseSessionCuesOptions = {
  isActive: boolean;
  soundPrefs?: SoundPrefs;
  onSoundPlaybackBlocked?: () => void;
  /** Fires when a failed sound plays after the automatic resume retry succeeds. */
  onSoundPlaybackResumed?: () => void;
};

/**
 * #732: plays a sit's cues — the rules for *when* live in `sessionCues.ts`;
 * this owns their cursor, the sound preferences they read, and the recovery
 * when the browser has suspended audio.
 *
 * The three clocks in `useElapsedClock` — local, buddy `syncClock`, and
 * controlled — each reach the end of a sit separately and all three owe the
 * same cues, so they all call one {@link SessionCues.end} rather than three
 * copies that drift.
 */
export function useSessionCues({
  isActive,
  soundPrefs,
  onSoundPlaybackBlocked,
  onSoundPlaybackResumed,
}: UseSessionCuesOptions): SessionCues {
  const onSoundPlaybackBlockedRef = useRef(onSoundPlaybackBlocked);
  onSoundPlaybackBlockedRef.current = onSoundPlaybackBlocked;
  const onSoundPlaybackResumedRef = useRef(onSoundPlaybackResumed);
  onSoundPlaybackResumedRef.current = onSoundPlaybackResumed;
  const soundPrefsRef = useRef(soundPrefs);
  soundPrefsRef.current = soundPrefs;
  const cursorRef = useRef<CueCursor>(INITIAL_CUE_CURSOR);

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
  /// #844: the same guard for a sit that has ended while the timer stays
  /// mounted — a solo sit keeps `BlockTimer` on screen while it saves. Nothing
  /// is left to play by then, so "Enable local audio" has nothing to recover,
  /// and that includes a completion bell whose own retry failed. Set by `end`,
  /// cleared once a clock advances again. Not by `reset`: the pause that
  /// follows a finished sit resets the cues, and the save is still running.
  const sitEndedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Built once: every method reads refs, never render-time values, so the
  // object handed to the clocks never goes stale.
  const [cues] = useState<SessionCues>(() => {
    const playEnabledSound = (play: () => boolean) => {
      if (play()) return;

      // #710: a sound can also start failing without a visibility change (the
      // browser suspending the context on its own). Try to resume before falling
      // back to the gesture-driven affordance, so the sound that failed — and any
      // that fail while the attempt is in flight — are not simply lost.
      //
      // The blocked callback only fires once that attempt has failed. Reporting
      // it up front would leave "Browser audio is paused" on screen for a
      // session whose sound recovered on its own. A successful retry reports
      // `onSoundPlaybackResumed` so that warning can clear. A play that fails
      // while an attempt is already in flight is covered by that attempt's result.
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
          if (resumed && retry?.()) {
            if (mountedRef.current) onSoundPlaybackResumedRef.current?.();
            return;
          }
          // The retry itself is deliberately not gated on the timer still being
          // active: a completion chime that failed is retried as the sit ends,
          // which is exactly when it is wanted. Only the banner is suppressed.
          if (!mountedRef.current || sitEndedRef.current) return;
          onSoundPlaybackBlockedRef.current?.();
        })
        .finally(() => {
          resumeInFlightRef.current = false;
        });
    };

    const playCues = (planned: Cue[], prefs: SoundPrefs | undefined) => {
      for (const cue of planned) {
        switch (cue.kind) {
          case "tick":
            playEnabledSound(playTick);
            break;
          case "chime":
            playEnabledSound(playChime);
            break;
          case "completion":
            playEnabledSound(playCompletion);
            break;
          case "voice": {
            const { second } = cue;
            playEnabledSound(() => playVoiceCountdown(second));
            break;
          }
          case "cancelVoice":
            cancelVoiceCountdownPlayback();
            break;
          case "haptic":
            // #712: not routed through `playEnabledSound` — the "browser audio
            // is paused" affordance is about the audio context, which vibration
            // never touches.
            maybeFireHaptic(prefs?.haptics, cue.cue);
            break;
        }
      }
    };

    return {
      reset() {
        cursorRef.current = freshCueCursor(soundPrefsRef.current);
      },
      seed(elapsed, totalSeconds) {
        cursorRef.current = seededCueCursor(elapsed, totalSeconds, soundPrefsRef.current);
      },
      rewind(elapsed, totalSeconds) {
        cursorRef.current = rewoundCueCursor(
          cursorRef.current,
          elapsed,
          totalSeconds,
          soundPrefsRef.current,
        );
      },
      advance(elapsed, totalSeconds) {
        sitEndedRef.current = false;
        const prefs = soundPrefsRef.current;
        const planned = planCountdownCues(cursorRef.current, elapsed, totalSeconds, prefs);
        cursorRef.current = planned.cursor;
        playCues(planned.cues, prefs);
      },
      advanceControlled(elapsed, totalSeconds) {
        sitEndedRef.current = false;
        const prefs = soundPrefsRef.current;
        const followed = followControlledVoice(cursorRef.current, elapsed, totalSeconds);
        const planned = planCountdownCues(followed, elapsed, totalSeconds, prefs);
        cursorRef.current = planned.cursor;
        playCues(planned.cues, prefs);
      },
      end() {
        sitEndedRef.current = true;
        const prefs = soundPrefsRef.current;
        playCues(planSessionEndCues(prefs), prefs);
      },
    };
  });

  return cues;
}
