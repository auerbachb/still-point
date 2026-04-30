import { addDaysToIsoDate, daysBetweenIsoDatesInclusive } from "./sessionCalendar";

export type HistoryJourneySession<T> = {
  sessionDate: string;
  sessionType?: string;
  /** Lexicographic tiebreaker for multiple sessions on one calendar day */
  sortKey: string;
  data: T;
};

export type HistoryJourneyRow<T> =
  | { kind: "missed"; date: string }
  | { kind: "session"; date: string; sessionIndexInDay: number; data: T };

/**
 * Standard sessions only (quick filtered upstream). Sort by calendar date then stable order.
 */
export function sortSessionsForHistory<T>(sessions: HistoryJourneySession<T>[]): HistoryJourneySession<T>[] {
  return [...sessions].sort((a, b) => {
    if (a.sessionDate !== b.sessionDate) return a.sessionDate.localeCompare(b.sessionDate);
    return a.sortKey.localeCompare(b.sortKey);
  });
}

export function buildHistoryJourneyRows<T>(sessions: HistoryJourneySession<T>[]): HistoryJourneyRow<T>[] {
  const sorted = sortSessionsForHistory(sessions);
  const rows: HistoryJourneyRow<T>[] = [];
  const perDayIndex = new Map<string, number>();

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (i > 0) {
      const prev = sorted[i - 1]!;
      const daysBetween = daysBetweenIsoDatesInclusive(prev.sessionDate, cur.sessionDate);
      for (let gap = 1; gap < daysBetween; gap++) {
        const missedDate = addDaysToIsoDate(prev.sessionDate, gap);
        rows.push({ kind: "missed", date: missedDate });
      }
    }
    const n = (perDayIndex.get(cur.sessionDate) ?? 0) + 1;
    perDayIndex.set(cur.sessionDate, n);
    rows.push({ kind: "session", date: cur.sessionDate, sessionIndexInDay: n, data: cur.data });
  }
  return rows;
}
