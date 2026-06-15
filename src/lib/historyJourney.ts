import { addDaysToIsoDate, daysBetweenIsoDatesInclusive } from "./sessionCalendar";

/**
 * Gaps of this many consecutive missed days or more collapse into a single
 * `collapsedGap` row; shorter gaps keep per-day `missed` rows (#379/#381).
 * Mirrors iOS `HistoryJourney.collapseGapThresholdDays`.
 */
export const COLLAPSE_GAP_THRESHOLD_DAYS = 3;

export type HistoryJourneySession<T> = {
  sessionDate: string;
  /** "standard" | "quick" (defaults to standard when absent) — drives per-type day numbering. */
  sessionType?: string;
  /** Lexicographic tiebreaker for multiple sessions on one calendar day */
  sortKey: string;
  data: T;
};

export type HistoryJourneyRow<T> =
  | { kind: "missed"; date: string }
  | { kind: "collapsedGap"; startDate: string; endDate: string; dayCount: number }
  | { kind: "session"; date: string; sessionIndexInDay: number; data: T };

/**
 * Sort by calendar date then stable tiebreaker. Includes all session types
 * (quick + standard) — quick sits are no longer filtered upstream (#381).
 */
export function sortSessionsForHistory<T>(sessions: HistoryJourneySession<T>[]): HistoryJourneySession<T>[] {
  return [...sessions].sort((a, b) => {
    if (a.sessionDate !== b.sessionDate) return a.sessionDate.localeCompare(b.sessionDate);
    return a.sortKey.localeCompare(b.sortKey);
  });
}

/**
 * Emits rows for the missed days strictly between `fromIso` and `toIso`: per-day
 * `missed` rows for short gaps, a single `collapsedGap` at/above the collapse
 * threshold. Mirrors iOS `HistoryJourney.appendGapRows`.
 */
function appendGapRows<T>(fromIso: string, toIso: string, rows: HistoryJourneyRow<T>[]): void {
  const daysBetween = daysBetweenIsoDatesInclusive(fromIso, toIso);
  const missedCount = Math.max(0, daysBetween - 1);
  if (missedCount <= 0) return;
  if (missedCount >= COLLAPSE_GAP_THRESHOLD_DAYS) {
    rows.push({
      kind: "collapsedGap",
      startDate: addDaysToIsoDate(fromIso, 1),
      endDate: addDaysToIsoDate(fromIso, missedCount),
      dayCount: missedCount,
    });
  } else {
    for (let gap = 1; gap <= missedCount; gap++) {
      rows.push({ kind: "missed", date: addDaysToIsoDate(fromIso, gap) });
    }
  }
}

/**
 * Builds journey rows from all sessions (standard and quick), sorted by
 * `sessionDate` then `sortKey`.
 *
 * `sessionIndexInDay` counts per session type within a calendar day, so standard
 * numbering is unaffected by interleaved quick sits. Pass `todayDate` (caller's
 * UTC calendar day, same convention used to stamp `sessionDate`) to also emit
 * gap rows between the last session and today; today itself is never missed (#381).
 */
export function buildHistoryJourneyRows<T>(
  sessions: HistoryJourneySession<T>[],
  todayDate?: string,
): HistoryJourneyRow<T>[] {
  const sorted = sortSessionsForHistory(sessions);
  const rows: HistoryJourneyRow<T>[] = [];
  const perDayTypeIndex = new Map<string, number>();

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (i > 0) {
      appendGapRows(sorted[i - 1]!.sessionDate, cur.sessionDate, rows);
    }
    const key = `${cur.sessionDate}|${cur.sessionType ?? "standard"}`;
    const n = (perDayTypeIndex.get(key) ?? 0) + 1;
    perDayTypeIndex.set(key, n);
    rows.push({ kind: "session", date: cur.sessionDate, sessionIndexInDay: n, data: cur.data });
  }

  const last = sorted[sorted.length - 1];
  if (todayDate && last) {
    appendGapRows(last.sessionDate, todayDate, rows);
  }
  return rows;
}
