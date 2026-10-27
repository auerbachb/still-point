/**
 * #732: when a sit's cues are due — the per-second tick, the final-minute voice
 * countdown, the minute chime, the repeating buzz, and the end-of-sit buzz and
 * bell.
 *
 * Pure: each function takes a {@link CueCursor} and returns the next one, plus
 * the cues owed in the order they play. `useSessionCues` plays them and the
 * session clocks in `useElapsedClock` decide when to call. Kept out of
 * `BlockTimer.tsx` so a new cue or a changed rule is a change here, with a
 * test, instead of another branch threaded through three clocks.
 */
import type { SoundPrefs } from "@/lib/audio";
import {
  completedMinuteBlockIndex,
  countdownSeconds,
  usesMinuteBlocks,
} from "@/lib/blockTimerGrid";
import {
  completedHapticIntervalIndex,
  hapticIntervalSeconds,
  nextRepeatingHaptic,
  type HapticCue,
} from "@/lib/haptics";

/**
 * How far into the sit each cue has already played.
 *
 * Every guard is monotonic: a cursor seeded at some position swallows the cues
 * before it, which is how a resume, a late join, or a restart avoids replaying
 * cues that are behind it.
 */
export type CueCursor = Readonly<{
  /** Last elapsed whole second that ticked; -1 before the first. */
  lastTickSec: number;
  /** Last remaining second announced by voice; 61 while none is (outside the final minute). */
  lastVoiceSec: number;
  /** Highest minute block whose end has been marked; -1 for none. */
  lastCompletedBlockIndex: number;
  /** Highest repeating-haptic interval already passed. */
  lastHapticIndex: number;
  /** The interval `lastHapticIndex` was counted in; null until first counted. */
  lastHapticInterval: number | null;
}>;

/**
 * One cue, in the order it should play.
 *
 * Sound preferences are applied while planning, because they are tangled into
 * the timing rules (voice mode moves the tick and the chime). The haptics
 * preference is not: `haptic` cues are planned whenever due, and
 * `maybeFireHaptic` decides at play time whether the device actually buzzes —
 * it stays the one strict gate for that opt-in (#712).
 */
export type Cue =
  | { kind: "tick" }
  | { kind: "chime" }
  | { kind: "completion" }
  | { kind: "voice"; second: number }
  | { kind: "cancelVoice" }
  | { kind: "haptic"; cue: HapticCue };

/** Before any clock has seeded it. A parent-controlled timer starts from here. */
export const INITIAL_CUE_CURSOR: CueCursor = {
  lastTickSec: -1,
  lastVoiceSec: 61,
  lastCompletedBlockIndex: -1,
  lastHapticIndex: 0,
  lastHapticInterval: null,
};

/** A sit starting from zero: nothing has played yet. */
export function freshCueCursor(prefs: SoundPrefs | undefined): CueCursor {
  return {
    ...INITIAL_CUE_CURSOR,
    lastHapticInterval: hapticIntervalSeconds(prefs?.hapticInterval),
  };
}

/**
 * A sit picked up at `elapsed` — a resume after a pause, or joining a synced
 * sit already under way. Every cue before `elapsed` counts as played.
 */
export function seededCueCursor(
  elapsed: number,
  totalSeconds: number,
  prefs: SoundPrefs | undefined,
): CueCursor {
  const hapticInterval = hapticIntervalSeconds(prefs?.hapticInterval);
  return {
    lastTickSec: Math.floor(elapsed),
    lastVoiceSec: totalSeconds - elapsed <= 60 ? countdownSeconds(elapsed, totalSeconds) : 61,
    lastCompletedBlockIndex: completedMinuteBlockIndex(elapsed, totalSeconds),
    lastHapticIndex: completedHapticIntervalIndex(elapsed, totalSeconds, hapticInterval),
    lastHapticInterval: hapticInterval,
  };
}

/**
 * A parent-controlled elapsed that moved backwards — a fresh run on the same
 * mounted timer. Re-seeds exactly as a synced join does, except the voice
 * cursor, which {@link followControlledVoice} keeps on its own rule.
 */
export function rewoundCueCursor(
  cursor: CueCursor,
  elapsed: number,
  totalSeconds: number,
  prefs: SoundPrefs | undefined,
): CueCursor {
  return {
    ...seededCueCursor(elapsed, totalSeconds, prefs),
    lastVoiceSec: cursor.lastVoiceSec,
  };
}

/**
 * Applied to every parent-controlled update before it is planned. Above the
 * final minute the voice cursor resets quietly; inside it, the cursor never
 * drops below the current second, so a step back does not re-announce a second
 * already spoken. The current second is rounded as the plan announces it.
 */
export function followControlledVoice(
  cursor: CueCursor,
  elapsed: number,
  totalSeconds: number,
): CueCursor {
  const remaining = totalSeconds - elapsed;
  return {
    ...cursor,
    lastVoiceSec:
      remaining > 60
        ? 61
        : Math.max(cursor.lastVoiceSec, countdownSeconds(elapsed, totalSeconds)),
  };
}

/**
 * The cues owed now that the clock has reached `elapsed`, still short of the
 * end. With no preferences at all nothing is owed and the cursor stays put.
 */
export function planCountdownCues(
  cursor: CueCursor,
  elapsed: number,
  totalSeconds: number,
  prefs: SoundPrefs | undefined,
): { cursor: CueCursor; cues: Cue[] } {
  if (!prefs) return { cursor, cues: [] };

  const next = { ...cursor };
  const cues: Cue[] = [];
  const remaining = totalSeconds - elapsed;
  const voiceMode = Boolean(prefs.voiceCountdown);
  // #853: the countdown speaks only in the final minute — the same window as
  // iOS `VoiceCountdownLogic.isActive`.
  const voiceActive = voiceMode && remaining > 0 && remaining <= 60;
  const currentSec = Math.floor(elapsed);

  // Voice mode stops the tick for the whole sit, where iOS stops it only while
  // `voiceActive`. Nobody hears the difference: exclusive cue mode (#807)
  // never has tick and voice on together.
  if (voiceMode) {
    if (remaining > 60) {
      if (next.lastVoiceSec <= 60) {
        cues.push({ kind: "cancelVoice" });
        next.lastVoiceSec = 61;
      }
    } else if (voiceActive) {
      // #922: the number the digits show — rounded up, as iOS
      // `VoiceCountdownLogic.announceSecond` rounds it, and 1–60 inside this
      // window. "60" holds the whole first second of the final minute, and
      // each later number starts as the digits reach it, a second after the
      // one before.
      const announceSec = countdownSeconds(elapsed, totalSeconds);
      if (announceSec !== next.lastVoiceSec) {
        next.lastVoiceSec = announceSec;
        cues.push({ kind: "voice", second: announceSec });
      }
    }
  } else if (prefs.tick && currentSec > next.lastTickSec) {
    next.lastTickSec = currentSec;
    cues.push({ kind: "tick" });
  }

  if (usesMinuteBlocks(totalSeconds)) {
    const completedBlockIndex = completedMinuteBlockIndex(elapsed, totalSeconds);

    if (completedBlockIndex > next.lastCompletedBlockIndex) {
      next.lastCompletedBlockIndex = completedBlockIndex;

      const blockEnd = (completedBlockIndex + 1) * 60;
      // Unchanged rule for *when* the marker fires: only on a completed
      // minute block with at least one full minute still to go. Since #711
      // the count no longer sets how many strikes play — the bell is one
      // strike — so it survives purely as that gate. Hoisted out of the chime
      // branch by #712 so the buzz can share it: one timing source, two
      // channels, marking the same instants. (Since #811 the buzz repeats on
      // its own interval below; the chime still uses this gate.)
      const fullMinuteRemains =
        Math.floor((totalSeconds - blockEnd) / 60) >= 1;

      // #853: in voice mode the chime still follows its own switch (#807). It
      // gives way only while the countdown is active, which in practice is
      // the bell that opens the final minute, due on the update that speaks
      // "60". iOS `SessionTickLogic.advance` uses the same rule.
      if (prefs.chime && !voiceActive && fullMinuteRemains) {
        cues.push({ kind: "chime" });
      }
    }
  }

  // A changed interval re-counts from here instead of firing: the boundaries
  // already behind the switch are not owed.
  const interval = hapticIntervalSeconds(prefs.hapticInterval);
  if (next.lastHapticInterval !== interval) {
    next.lastHapticInterval = interval;
    next.lastHapticIndex = completedHapticIntervalIndex(elapsed, totalSeconds, interval);
    return { cursor: next, cues };
  }
  const hapticUpdate = nextRepeatingHaptic({
    elapsedSeconds: elapsed,
    durationSeconds: totalSeconds,
    intervalSeconds: interval,
    lastCompletedIndex: next.lastHapticIndex,
  });
  next.lastHapticIndex = hapticUpdate.completedIndex;
  if (hapticUpdate.shouldFire) {
    cues.push({ kind: "haptic", cue: "minuteMarker" });
  }
  return { cursor: next, cues };
}

/**
 * Everything the end of a sit announces, in both channels.
 *
 * #712: the buzz is deliberately not gated on `completion`. Silencing the bell
 * must not silence the buzz — that is the whole reason the preference exists.
 * Planned only when the timer actually ran out, so it needs no abandon or
 * end-early guard — a discarded sit never gets here.
 */
export function planSessionEndCues(prefs: SoundPrefs | undefined): Cue[] {
  const cues: Cue[] = [{ kind: "haptic", cue: "sessionEnd" }];
  if (prefs?.completion) cues.push({ kind: "completion" });
  return cues;
}
