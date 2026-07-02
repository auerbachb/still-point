import { isValidSessionCalendarDate } from "./sessionCalendar";
import { sessionTimeSeconds, type HistorySessionTimeInput } from "./historyStats";

export type MonthDayState = "future" | "today" | "meditated" | "missed";

export type MonthGridDay = {
  isoDate: string;
  dayOfMonth: number;
  state: MonthDayState;
  /** Short labels per session that day, e.g. ["8m", "1m"]. */
  durationLabels: string[];
};

export type MonthGridCell =
  | { kind: "blank" }
  | { kind: "day"; day: MonthGridDay };

export type PriorMonthSummary = {
  yearMonth: string;
  label: string;
  daysActive: number;
  daysInMonth: number;
  totalTimeSeconds: number;
};

function parseYearMonth(isoDate: string): { year: number; month: number } {
  const [y, m] = isoDate.split("-").map(Number);
  return { year: y, month: m };
}

function yearMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayUtc(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function monthLabel(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1, 12));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Format sit length for calendar cells — minutes when ≥60s, else seconds. */
export function formatSessionDurationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

function groupSessionsByDate(
  sessions: HistorySessionTimeInput[],
): Map<string, HistorySessionTimeInput[]> {
  const map = new Map<string, HistorySessionTimeInput[]>();
  for (const session of sessions) {
    if (!isValidSessionCalendarDate(session.sessionDate)) continue;
    const date = session.sessionDate!;
    (map.get(date) ?? map.set(date, []).get(date)!).push(session);
  }
  return map;
}

function dayState(isoDate: string, todayIso: string, hasSession: boolean): MonthDayState {
  if (isoDate > todayIso) return "future";
  if (isoDate === todayIso) return hasSession ? "meditated" : "today";
  return hasSession ? "meditated" : "missed";
}

/**
 * Builds a Sunday-start month grid for the calendar month containing `todayIso`.
 * Any session on a day (including quick sits) marks the cell meditated (#379/#83).
 */
export function buildCurrentMonthGrid(
  sessions: HistorySessionTimeInput[],
  todayIso: string,
): { yearMonth: string; monthLabel: string; cells: MonthGridCell[] } {
  const { year, month } = parseYearMonth(todayIso);
  const ym = yearMonthKey(year, month);
  const byDate = groupSessionsByDate(sessions);
  const dim = daysInCalendarMonth(year, month);
  const firstIso = `${ym}-01`;
  const leadingBlanks = weekdayUtc(firstIso);

  const cells: MonthGridCell[] = [];
  for (let i = 0; i < leadingBlanks; i++) {
    cells.push({ kind: "blank" });
  }

  for (let day = 1; day <= dim; day++) {
    const dd = String(day).padStart(2, "0");
    const isoDate = `${ym}-${dd}`;
    const daySessions = byDate.get(isoDate) ?? [];
    const durationLabels = daySessions.map(s => formatSessionDurationLabel(sessionTimeSeconds(s)));
    cells.push({
      kind: "day",
      day: {
        isoDate,
        dayOfMonth: day,
        state: dayState(isoDate, todayIso, daySessions.length > 0),
        durationLabels,
      },
    });
  }

  return { yearMonth: ym, monthLabel: monthLabel(year, month), cells };
}

/**
 * One compact row per calendar month strictly before the month of `todayIso`.
 * Spans from the earliest session month through the month before current.
 */
export function buildPriorMonthSummaries(
  sessions: HistorySessionTimeInput[],
  todayIso: string,
): PriorMonthSummary[] {
  const { year: todayYear, month: todayMonth } = parseYearMonth(todayIso);
  const currentYm = yearMonthKey(todayYear, todayMonth);

  const validDates = sessions
    .map(s => s.sessionDate)
    .filter((d): d is string => isValidSessionCalendarDate(d));
  if (validDates.length === 0) return [];

  const earliest = validDates.reduce((a, b) => (a < b ? a : b));
  const { year: startYear, month: startMonth } = parseYearMonth(earliest);
  const byDate = groupSessionsByDate(sessions);

  const summaries: PriorMonthSummary[] = [];
  let y = startYear;
  let m = startMonth;

  while (true) {
    const ym = yearMonthKey(y, m);
    if (ym >= currentYm) break;

    const dim = daysInCalendarMonth(y, m);
    let daysActive = 0;
    let totalTimeSeconds = 0;

    for (let day = 1; day <= dim; day++) {
      const dd = String(day).padStart(2, "0");
      const isoDate = `${ym}-${dd}`;
      const daySessions = byDate.get(isoDate);
      if (daySessions && daySessions.length > 0) {
        daysActive++;
        for (const s of daySessions) {
          totalTimeSeconds += sessionTimeSeconds(s);
        }
      }
    }

    summaries.push({
      yearMonth: ym,
      label: monthLabel(y, m),
      daysActive,
      daysInMonth: dim,
      totalTimeSeconds,
    });

    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  return summaries;
}

/** Human-readable total time for summary rows. */
export function formatTotalTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
