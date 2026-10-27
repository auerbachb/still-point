// Pure focus-activity helpers (#765 increment 2/5, #836). No DOM or timer state
// lives here: `FocusActivityView` owns the wall clock and calls into these, so
// the countdown, end-of-session and goal rules stay unit-testable.
import { elapsedDisplay, elapsedSeconds } from "./breathCounting";
import { advanceFocusActivityDay } from "./duration";

/** What a focus session reports when it ends. */
export type FocusSessionResult = {
  /** The goal in seconds: the planned length, whether or not it was reached. */
  duration: number;
  /** Whole seconds spent, never more than the goal. */
  actualTime: number;
  /** True once the countdown reached zero. */
  completed: boolean;
};

/** How a focus session ended: the countdown ran out, or the person pressed End. */
export type FocusEndReason = "expired" | "ended";

const SECONDS_PER_HOUR = 3600;

/**
 * The goal as Home shows it: "1 min", "30 min", "1 hr", "1 hr 30 min", "2 hr".
 * Goals step a whole minute at a time, so there are never stray seconds.
 */
export function formatFocusGoal(seconds: number): string {
  const totalMinutes = Math.round(Math.max(0, seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

/**
 * Whole seconds left on the countdown. Starts at the goal, reads 0 exactly
 * when the goal has elapsed, and never goes below it.
 */
export function focusRemainingSeconds(startMs: number, nowMs: number, goalSeconds: number): number {
  return Math.max(0, goalSeconds - elapsedSeconds(startMs, nowMs));
}

/**
 * Countdown digits: "m:ss" under an hour, "h:mm:ss" from an hour, so the
 * two-hour cap reads "2:00:00" rather than "120:00".
 */
export function formatFocusCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < SECONDS_PER_HOUR) return elapsedDisplay(s);
  const hours = Math.floor(s / SECONDS_PER_HOUR);
  const minutes = Math.floor((s % SECONDS_PER_HOUR) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The countdown's font size for a goal. A goal of an hour or more starts with
 * an hour field, three characters wider, so it gets smaller digits and
 * "2:00:00" still fits a 375px screen. Sized from the goal rather than the time
 * left, so the digits never change size mid-session.
 */
export function focusCountdownFontSize(goalSeconds: number): string {
  return goalSeconds >= SECONDS_PER_HOUR ? "min(96px, 16vw)" : "min(120px, 22vw)";
}

/**
 * What a focus session saves when it ends, or `null` when there is nothing to
 * save (End pressed before a whole second passed).
 *
 * Elapsed time comes from the wall clock and is capped at the goal. Reaching
 * the goal completes the session however it ended: an End that lands at or
 * after zero (a tab suspended past the deadline, say) still reached it.
 */
export function resolveFocusEnd({
  startMs,
  nowMs,
  goalSeconds,
  reason,
}: {
  startMs: number;
  nowMs: number;
  goalSeconds: number;
  reason: FocusEndReason;
}): FocusSessionResult | null {
  const elapsed = Math.min(goalSeconds, elapsedSeconds(startMs, nowMs));
  if (reason === "expired" || elapsed >= goalSeconds) {
    return { duration: goalSeconds, actualTime: goalSeconds, completed: true };
  }
  if (elapsed === 0) return null;
  return { duration: goalSeconds, actualTime: elapsed, completed: false };
}

/**
 * The focus goal counter to show once a completed focus session is stored
 * (synced or queued). The server steps `focusActivityDay` once per completed
 * session (`advanceFocusActivityDay`). Taking the max keeps that a single step
 * when a server re-read that already applied it lands before this merge.
 */
export function focusActivityDayAfterCompletedSave(
  currentDay: number | undefined,
  sessionDay: number,
): number {
  return Math.max(currentDay ?? 1, advanceFocusActivityDay("focus", true, sessionDay));
}
