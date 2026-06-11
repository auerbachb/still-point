import { BASE_DURATION, INCREMENT, durationForDay } from "@/lib/constants";

const MS_PER_DAY = 86_400_000;

export function buddyDurationForDay(currentDay: number): number {
  return durationForDay(currentDay);
}

/** Lobby copy (#349): buddy sits pace to the shortest participant length. */
export const BUDDY_SESSION_LENGTH_EXPLAINER =
  "Buddy sits use the shortest of everyone's current sit length (at least 1 minute). The group timer is set automatically—you can't choose a longer session.";

/**
 * Normalized buddy session length (#349): min of participant current lengths, floored at 1 minute.
 */
export function normalizedBuddySessionDurationSeconds(currentDays: number[]): number {
  if (currentDays.length === 0) {
    return BASE_DURATION;
  }
  const lengths = currentDays.map((day) => buddyDurationForDay(day));
  return Math.max(BASE_DURATION, Math.min(...lengths));
}

/**
 * Whole calendar days from `from` to `to`, measured at UTC day granularity (#361).
 *
 * Both instants are floored to their UTC calendar date, so the result is the number of date
 * boundaries crossed: same UTC date → 0, the next UTC day → 1. Negative spans (a session already in
 * the past) clamp to 0. UTC is intentional for v1 — day granularity tolerates user-timezone variance.
 */
export function calendarDaysUntilUTC(from: Date, to: Date): number {
  const fromMidnight = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toMidnight = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.max(0, Math.floor((toMidnight - fromMidnight) / MS_PER_DAY));
}

/**
 * Projected buddy *calendar invite* length (#361).
 *
 * Scheduled buddy sits grow before they run: the shortest participant gains +10s per completed
 * standard day. So when we write a calendar event for a future sit we show the length we expect the
 * shortest participant to reach by `scheduledStartAt`, not today's length. Take the live minimum
 * participant length now (`normalizedBuddySessionDurationSeconds`, #349) and advance it by +10s per
 * whole UTC calendar day until the session, floored at 60s.
 *
 * 0 days out (same-day / immediate) projects +0s — identical to the live normalized length. This is
 * an estimate for the invite only; the in-app timer is still normalized live at session start (#349).
 */
export function projectedCalendarDurationSeconds(
  currentDays: number[],
  syncAt: Date,
  scheduledStartAt: Date,
): number {
  const base = normalizedBuddySessionDurationSeconds(currentDays);
  const daysUntil = calendarDaysUntilUTC(syncAt, scheduledStartAt);
  return Math.max(BASE_DURATION, base + daysUntil * INCREMENT);
}
