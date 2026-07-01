/**
 * Miss-a-day recovery (#238): a shared duration + progression function so every
 * surface that plans or advances a standard sit's length (HomeView, SessionView,
 * CompletionScreen, HistoryView, the `/api/sessions` completion handler) agrees on
 * what "today's duration" means in both normal and recovery modes.
 *
 * Recovery model: missing 2+ calendar days freezes `recoveryTargetDay` at the
 * pre-miss `currentDay` (the level to ramp back to) and starts a step counter.
 * `currentDay` itself is left untouched for the whole ramp, so once the final
 * recovery step completes and the recovery columns clear, the very next session
 * naturally lands back on `durationForDay(currentDay)` — the prior level.
 */
import { BASE_DURATION, QUICK_DURATION, durationForDay, shouldAdvanceDay, type SessionType } from "./constants";
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
 * Duration (seconds) for a given recovery step (1-indexed). Step 1 is always exactly
 * `BASE_DURATION` (the "reset to 1 minute" session immediately after the miss); later
 * steps ramp linearly by `difference / totalSteps` seconds. The session that follows
 * the final recovery step is no longer "in recovery" — it uses the normal
 * `durationForDay(targetDay)` via `activeRecovery` returning `null`, landing exactly
 * back on the prior duration.
 */
export function recoveryStepDuration(targetDay: number, totalSteps: number, step: number): number {
  if (totalSteps <= 0) return BASE_DURATION;
  const priorDuration = durationForDay(targetDay);
  const difference = priorDuration - BASE_DURATION;
  const ramp = difference / totalSteps;
  const clampedStep = Math.min(Math.max(step, 1), totalSteps);
  // Round to avoid float drift (e.g. a difference not evenly divisible by totalSteps)
  // leaking fractional seconds into a stored `sessions.duration` integer column.
  return Math.round(BASE_DURATION + ramp * (clampedStep - 1));
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
 * the recovery ramp forward (clearing it once the final step is done, leaving
 * `currentDay` untouched) or, outside recovery, bumps `currentDay` by one as before.
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
      currentDay: state.currentDay,
      recoveryTargetDay: stillRecovering ? active.recoveryTargetDay : null,
      recoveryCurrentStep: stillRecovering ? nextStep : null,
      recoveryTotalSteps: stillRecovering ? active.recoveryTotalSteps : null,
    };
  }

  return { ...state, currentDay: state.currentDay + 1 };
}
