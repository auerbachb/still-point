import { isValidSessionCalendarDate } from "./sessionCalendar";
import { sessionTimeSeconds, type HistorySessionTimeInput } from "./historyStats";

export type MonthlySummary = {
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

export function yearMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthLabel(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1, 12));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function shortMonthLabel(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1, 12));
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
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

function advanceMonth(year: number, month: number, delta: number): { year: number; month: number } {
  let y = year;
  let m = month + delta;
  while (m < 1) {
    m += 12;
    y--;
  }
  while (m > 12) {
    m -= 12;
    y++;
  }
  return { year: y, month: m };
}

/** Aggregate days-active and total sit time for one calendar month. */
export function aggregateMonthSummary(
  sessions: HistorySessionTimeInput[],
  year: number,
  month: number,
): MonthlySummary {
  const ym = yearMonthKey(year, month);
  const byDate = groupSessionsByDate(sessions);
  const dim = daysInCalendarMonth(year, month);
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

  return {
    yearMonth: ym,
    label: monthLabel(year, month),
    daysActive,
    daysInMonth: dim,
    totalTimeSeconds,
  };
}

/**
 * Trailing 12 calendar months ending with the month containing `todayIso`.
 * Used by the year-in-review grid (#380).
 */
export function buildTrailing12MonthSummaries(
  sessions: HistorySessionTimeInput[],
  todayIso: string,
): MonthlySummary[] {
  const { year: todayYear, month: todayMonth } = parseYearMonth(todayIso);
  const start = advanceMonth(todayYear, todayMonth, -11);

  const summaries: MonthlySummary[] = [];
  let y = start.year;
  let m = start.month;

  for (let i = 0; i < 12; i++) {
    summaries.push(aggregateMonthSummary(sessions, y, m));
    ({ year: y, month: m } = advanceMonth(y, m, 1));
  }

  return summaries;
}

/** Short month label for compact grid cells (e.g. "Jul 2026"). */
export function formatShortMonthLabel(yearMonth: string): string {
  const { year, month } = parseYearMonth(`${yearMonth}-01`);
  return shortMonthLabel(year, month);
}

/**
 * One compact row per calendar month strictly before the month of `todayIso`.
 * Spans from the earliest session month through the month before current.
 */
export function buildPriorMonthSummaries(
  sessions: HistorySessionTimeInput[],
  todayIso: string,
): MonthlySummary[] {
  const { year: todayYear, month: todayMonth } = parseYearMonth(todayIso);
  const currentYm = yearMonthKey(todayYear, todayMonth);

  const validDates = sessions
    .map(s => s.sessionDate)
    .filter((d): d is string => isValidSessionCalendarDate(d));
  if (validDates.length === 0) return [];

  const earliest = validDates.reduce((a, b) => (a < b ? a : b));
  const { year: startYear, month: startMonth } = parseYearMonth(earliest);

  const summaries: MonthlySummary[] = [];
  let y = startYear;
  let m = startMonth;

  while (true) {
    const ym = yearMonthKey(y, m);
    if (ym >= currentYm) break;

    summaries.push(aggregateMonthSummary(sessions, y, m));
    ({ year: y, month: m } = advanceMonth(y, m, 1));
  }

  return summaries;
}
