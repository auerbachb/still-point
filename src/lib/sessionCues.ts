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
import { minuteChimeApplies, type SoundPrefs } from "@/lib/audio";
import {
  completedMinuteBlockIndex,
  countdownSeconds,
  usesMinuteBlocks,
} from "@/lib/blockTimerGrid";
import {
  completedHapticIntervalIndex,
  hapticIntervalSeconds,
  nextRepeatingHaptic,
  repeatingHapticCue,
  type HapticCue,
} from "@/lib/haptics";

/**
 * How far into the sit each cue has already played — one consumed position per
 * channel.
 *
 * A cursor seeded at some position swallows the cues before it, which is how a
 * resume, a late join, or a restart avoids replaying cues that are behind it.
 * Within a run the tick, chime, and haptic fields only move forward; the voice
 * field counts down, and {@link followControlledVoice} may raise it. A reset or
 * a rewind re-arms them all for a new run.
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

/**
 * #1176: how late the minute bell may still strike, in seconds. Above the 50 ms
 * clock and a background tab's 1 Hz throttling, well under the minute between
 * bells. Mirrors iOS `CueDeliveryLogic.maxLatenessSeconds`.
 */
export const CHIME_MAX_LATENESS_SECONDS = 1.5;

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
 *
 * A controlled update runs: this rewind when elapsed moved back, then
 * {@link followControlledVoice}, then {@link planCountdownCues}. The voice
 * cursor survives the rewind so the plan can still see a countdown in progress
 * and cancel it, and so a step back inside the final minute suppresses only the
 * number it lands on. Restarts differ on purpose: a fresh local run and a first
 * controlled mount both tick at second zero, while a controlled rewind seeds
 * second zero as already ticked.
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
 * Applied to every parent-controlled update before it is planned. Inside the
 * final minute the cursor never drops below the current second, so a step back
 * does not re-announce a second already spoken. The current second is rounded
 * as the plan announces it.
 *
 * Above the final minute the cursor is left alone: {@link planCountdownCues}
 * resets it there, and cancels a clip still playing on the way (#844). Resetting
 * it here first, as this used to, made that cancel unreachable on the controlled
 * path, so a spoken number played out after a step back or a restart.
 */
export function followControlledVoice(
  cursor: CueCursor,
  elapsed: number,
  totalSeconds: number,
): CueCursor {
  if (totalSeconds - elapsed > 60) return cursor;
  return {
    ...cursor,
    lastVoiceSec: Math.max(cursor.lastVoiceSec, countdownSeconds(elapsed, totalSeconds)),
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

  // Back above the final minute — a parent-controlled step back or restart
  // (#844): the countdown re-arms, and a clip still playing stops. The reset
  // holds outside voice mode too, so turning voice on later in the sit does not
  // inherit a stale second.
  if (remaining > 60 && next.lastVoiceSec <= 60) {
    if (voiceMode) cues.push({ kind: "cancelVoice" });
    next.lastVoiceSec = 61;
  }

  // Voice mode stops the tick for the whole sit, where iOS stops it only while
  // `voiceActive`. Nobody hears the difference: exclusive cue mode (#807)
  // never has tick and voice on together.
  if (voiceMode) {
    if (voiceActive) {
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
      // The chime marks a completed minute block only while at least one
      // full minute is still to go. The repeating buzz does not use this
      // gate: it keeps its own interval cursor below (#811).
      const fullMinuteRemains =
        Math.floor((totalSeconds - blockEnd) / 60) >= 1;

      // #853: in voice mode the chime still follows its own switch (#807). It
      // gives way only while the countdown is active, which in practice is
      // the bell that opens the final minute, due on the update that speaks
      // "60". iOS `SessionTickLogic.advance` uses the same rule.
      // #1176: on time or not at all. A bell owed long after its minute — the
      // tab was throttled or the device slept — is dropped instead of struck
      // at a random moment. iOS `CueDeliveryLogic.isOnTime` uses the same budget.
      const onTime = elapsed - blockEnd <= CHIME_MAX_LATENESS_SECONDS;
      // #1176 (owner decision): haptic mode rings no minute bell. The stored
      // switch is left alone, so tick mode still rings. The cursor above has
      // already moved, so leaving haptic mode replays nothing.
      const chimeOn = prefs.chime && minuteChimeApplies(prefs);
      if (chimeOn && !voiceActive && fullMinuteRemains && onTime) {
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
    cues.push({ kind: "haptic", cue: repeatingHapticCue(interval) });
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
 *
 * #1176: `lateBySeconds` is how long after the sit's real end the clock first
 * saw it (a throttled tab, a sleeping device). Past
 * {@link CHIME_MAX_LATENESS_SECONDS} the end sound is dropped, on time or not
 * at all. The end buzz is kept, and so is the save, which the caller owns.
 * iOS `SessionTickLogic` drops a late completion sound by the same budget.
 */
export function planSessionEndCues(
  prefs: SoundPrefs | undefined,
  lateBySeconds = 0,
): Cue[] {
  const cues: Cue[] = [{ kind: "haptic", cue: "sessionEnd" }];
  if (prefs?.completion && lateBySeconds <= CHIME_MAX_LATENESS_SECONDS) {
    cues.push({ kind: "completion" });
  }
  return cues;
}
