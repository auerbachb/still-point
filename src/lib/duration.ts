/**
 * Miss-a-day recovery (#238): a shared duration + progression function so every
 * surface that plans or advances a standard sit's length (HomeView, SessionView,
 * CompletionScreen, HistoryView, the `/api/sessions` completion handler) agrees on
 * what "today's duration" means in both normal and recovery modes.
 *
 * Recovery model: missing 2+ calendar days freezes `recoveryTargetDay` at the
 * pre-miss `currentDay` (the level to ramp back to) and starts a step counter.
 * `currentDay` is frozen mid-ramp but advances by one when the final recovery
 * step completes (#559), so sparse sitters are not stuck re-entering recovery at
 * the same day forever before they can climb toward the 10-minute cap.
 */
import { BASE_DURATION, BLOCK_DURATION, FORK_DAY, QUICK_DURATION, durationForDay, shouldAdvanceDay, type SessionType } from "./constants";
import { daysBetweenIsoDatesInclusive } from "./sessionCalendar";

/** Recovery ramps back to the prior duration level over at most this many sessions. */
export const RECOVERY_MAX_STEPS = 5;

/** A 2+ calendar-day gap since the last completed standard sit triggers recovery. */
export const MISSED_DAY_GAP_THRESHOLD = 2;

export type RecoveryFields = {
  recoveryTargetDay: number | null;
  recoveryCurrentStep: number | null;
  recoveryTotalSteps: number | null;
};

export type ActiveRecovery = {
  recoveryTargetDay: number;
  recoveryCurrentStep: number;
  recoveryTotalSteps: number;
};

export type ProgressionState = {
  currentDay: number;
} & RecoveryFields;

/**
 * Normalizes the nullable trio into a concrete in-progress recovery, or `null` when
 * recovery isn't active (any field missing, no steps needed, or already exhausted).
 */
export function activeRecovery(fields: RecoveryFields): ActiveRecovery | null {
  const { recoveryTargetDay, recoveryCurrentStep, recoveryTotalSteps } = fields;
  if (recoveryTargetDay == null || recoveryCurrentStep == null || recoveryTotalSteps == null) {
    return null;
  }
  if (recoveryTotalSteps <= 0 || recoveryCurrentStep < 1 || recoveryCurrentStep > recoveryTotalSteps) {
    return null;
  }
  return { recoveryTargetDay, recoveryCurrentStep, recoveryTotalSteps };
}

/**
 * Number of recovery sessions needed to ramp back to `targetDay`'s duration: one step
 * per lost ten-second increment, capped at `RECOVERY_MAX_STEPS` for long streaks.
 * A user on day 1 (nothing lost) needs zero steps — there is nothing to recover.
 */
export function recoveryTotalStepsFor(targetDay: number): number {
  return Math.max(0, Math.min(RECOVERY_MAX_STEPS, targetDay - 1));
}

/**
 * Rounds a duration (seconds) to the nearest whole 10-second block (#661).
 *
 * The session timer renders progress as `BLOCK_DURATION`-second blocks
 * (`Math.ceil(duration / BLOCK_DURATION)` in BlockTimer/HomeView/CompletionScreen), so a
 * duration that is not a multiple of the block size ends the sit part-way through a
 * partially-filled final block. Never returns zero: a session is at least one block long.
 *
 * Ties round up (`Math.round` is half-up for the positive values used here), matching
 * Swift's `.rounded()` (half-away-from-zero) so web and iOS agree on x5 midpoints.
 */
export function roundToNearestBlock(seconds: number): number {
  return Math.max(1, Math.round(seconds / BLOCK_DURATION)) * BLOCK_DURATION;
}

/**
 * Duration (seconds) for a given recovery step (1-indexed). Step 1 is always exactly
 * `BASE_DURATION` (the "reset to 1 minute" session immediately after the miss); later
 * steps ramp linearly by `difference / totalSteps` seconds. Completing the final
 * recovery step clears recovery and advances `currentDay` by one (#559), so the
 * next standard sit uses `durationForDay(currentDay)` at the newly earned level.
 *
 * Every step is snapped to a whole 10-second block (#661) so a recovery sit never ends
 * mid-block. Rounding happens here, at the computation layer, so every consumer — web,
 * iOS, and the stats/history surfaces — sees the same block-aligned number. The ramp
 * stays monotonic (rounding is order-preserving) and, because `durationForDay` is itself
 * block-aligned and the per-step ramp is at least one block, a recovery step never
 * rounds up to or past the target day's own duration.
 */
export function recoveryStepDuration(targetDay: number, totalSteps: number, step: number): number {
  if (totalSteps <= 0) return BASE_DURATION;
  const priorDuration = durationForDay(targetDay);
  const difference = priorDuration - BASE_DURATION;
  const ramp = difference / totalSteps;
  const clampedStep = Math.min(Math.max(step, 1), totalSteps);
  // Rounding to a block also absorbs float drift (e.g. a difference not evenly divisible
  // by totalSteps) that would otherwise leak fractional seconds into the stored
  // `sessions.duration` integer column.
  return roundToNearestBlock(BASE_DURATION + ramp * (clampedStep - 1));
}

/** The shared duration function (#238): every planner/display for a sit's length
 *  must go through this so normal and recovery modes never drift apart. */
export function sessionDurationForUser(
  sessionType: SessionType,
  currentDay: number,
  recovery: RecoveryFields,
): number {
  if (sessionType === "quick") return QUICK_DURATION;
  const active = activeRecovery(recovery);
  if (active) {
    return recoveryStepDuration(active.recoveryTargetDay, active.recoveryTotalSteps, active.recoveryCurrentStep);
  }
  return durationForDay(currentDay);
}

/** Builds the recovery state to persist when a 2+ day gap is detected. Returns `null`
 *  when the user has no meaningful progress to recover (day 1 — nothing lost). */
export function startRecovery(currentDay: number): ActiveRecovery | null {
  const totalSteps = recoveryTotalStepsFor(currentDay);
  if (totalSteps <= 0) return null;
  return { recoveryTargetDay: currentDay, recoveryCurrentStep: 1, recoveryTotalSteps: totalSteps };
}

/**
 * Detects whether a 2+ calendar-day gap since the last completed standard session
 * should start recovery. Returns `null` when no new recovery should start: already
 * recovering, gap below the threshold, or no completed standard session yet to
 * measure from (nothing to have missed).
 */
export function detectMissedDayGap(params: {
  lastCompletedSessionDate: string | null;
  todayIso: string;
  currentDay: number;
  recovery: RecoveryFields;
}): ActiveRecovery | null {
  if (activeRecovery(params.recovery)) return null;
  if (!params.lastCompletedSessionDate) return null;
  const gapDays = daysBetweenIsoDatesInclusive(params.lastCompletedSessionDate, params.todayIso);
  if (gapDays < MISSED_DAY_GAP_THRESHOLD) return null;
  return startRecovery(params.currentDay);
}

/**
 * Advances progression after a session save — the shared replacement for the old
 * "always bump currentDay" rule. Non-advancing sessions (quick sits, incomplete
 * standard sits) return `state` unchanged. A completed standard sit either steps
 * the recovery ramp forward (clearing it and bumping `currentDay` once the final
 * step is done) or, outside recovery, bumps `currentDay` by one as before.
 */
export function advanceProgression(
  sessionType: SessionType,
  completed: boolean,
  state: ProgressionState,
): ProgressionState {
  if (!shouldAdvanceDay(sessionType, completed)) return state;

  const active = activeRecovery(state);
  if (active) {
    const nextStep = active.recoveryCurrentStep + 1;
    const stillRecovering = nextStep <= active.recoveryTotalSteps;
    return {
      currentDay: stillRecovering ? state.currentDay : state.currentDay + 1,
      recoveryTargetDay: stillRecovering ? active.recoveryTargetDay : null,
      recoveryCurrentStep: stillRecovering ? nextStep : null,
      recoveryTotalSteps: stillRecovering ? active.recoveryTotalSteps : null,
    };
  }

  return { ...state, currentDay: state.currentDay + 1 };
}

/**
 * Dual-track fork (#240): once the primary track has passed the 10-minute mark
 * (`currentDay > FORK_DAY`, i.e. the day-55 ten-minute sit is behind them) the
 * user may opt into a second daily track. Eligibility is derived from the
 * primary counter alone so it does not need its own persisted flag.
 */
export function isDualTrackEligible(currentDay: number): boolean {
  return currentDay > FORK_DAY;
}

/**
 * Advance the independent second-track counter (#240) after a session save. The
 * second track has no recovery ramp: a completed standard sit bumps it by one
 * (its duration is `durationForDay(secondTrackDay)`, which caps at 10 minutes
 * just like the primary track); anything else leaves it unchanged. Mirrors the
 * non-recovery branch of `advanceProgression` so both tracks step in lockstep.
 */
export function advanceSecondTrackDay(
  sessionType: SessionType,
  completed: boolean,
  secondTrackDay: number,
): number {
  return shouldAdvanceDay(sessionType, completed) ? secondTrackDay + 1 : secondTrackDay;
}
