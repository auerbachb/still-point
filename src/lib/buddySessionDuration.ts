import { BASE_DURATION, durationForDay } from "@/lib/constants";

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
