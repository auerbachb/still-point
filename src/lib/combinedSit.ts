/**
 * #769: today's two sits done as one. A dual-track sitter runs Track One's and
 * Track Two's sits back to back as one long sit. It is saved as one standard
 * row on the primary track with `combined: true` (#890) and counts for both
 * tracks (`tracksCredited` in `sessionCalendar.ts`).
 *
 * The rules live here once. The golden fixture
 * `shared/test-fixtures/combinedSit.json` pins them, and the iOS suite reads the
 * same file (#896), so the two apps cannot drift apart on what a combined sit is.
 */
import { durationForDay } from "./constants";

/**
 * Planned length of a combined sit: Track One's planned length plus Track
 * Two's. Recovery is ignored on purpose. The sit is never offered while a
 * recovery ramp is running (`isCombineOffered`), so there is no combined
 * recovery length to define.
 */
export function combinedDurationForUser(currentDay: number, secondTrackDay: number): number {
  return durationForDay(currentDay) + durationForDay(secondTrackDay);
}

export type CombineOfferState = {
  dualTrackEnabled: boolean;
  primaryDoneToday: boolean;
  secondDoneToday: boolean;
  recoveryActive: boolean;
};

/** Whether today's two sits can be done as one: a dual-track account with
 *  neither track done today and no recovery ramp running. */
export function isCombineOffered({
  dualTrackEnabled,
  primaryDoneToday,
  secondDoneToday,
  recoveryActive,
}: CombineOfferState): boolean {
  return dualTrackEnabled && !primaryDoneToday && !secondDoneToday && !recoveryActive;
}

/**
 * The completion screen's "tomorrow" preview after a combined sit: what the
 * next two sits add up to. A completed sit moves both tracks on a day; one
 * ended early moves neither, so the preview is today's combined length again.
 * `currentDay` and `secondTrackDay` are the counters before this sit was saved.
 */
export function previewNextCombinedDuration({
  completed,
  currentDay,
  secondTrackDay,
}: {
  completed: boolean;
  currentDay: number;
  secondTrackDay: number;
}): number {
  return completed
    ? combinedDurationForUser(currentDay + 1, secondTrackDay + 1)
    : combinedDurationForUser(currentDay, secondTrackDay);
}

/**
 * A sit payload's `combined` key: `{ combined: true }` for a combined sit, and
 * no key at all for any other. Spread it rather than assigning `combined`, so
 * an ordinary sit's payload, and the queue entry stored from it, stays exactly
 * what it was before #769.
 */
export function combinedSitField(combined: boolean | undefined): { combined?: true } {
  return combined === true ? { combined: true } : {};
}
