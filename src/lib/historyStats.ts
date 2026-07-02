import { addDaysToIsoDate, isValidSessionCalendarDate } from "./sessionCalendar";

export const TRAILING_4_WEEK_DAYS = 28;
const SECONDS_IN_4_WEEKS = TRAILING_4_WEEK_DAYS * 24 * 60 * 60;
const TEN_THOUSAND_HOURS_SECONDS = 10_000 * 60 * 60;

export type HistorySessionTimeInput = {
  sessionDate?: string;
  actualTime?: number | null;
  duration: number;
  bonusSeconds?: number;
};

export type HistoryPeriodStats = {
  trailing4WeekDays: number;
  trailing4WeekDayPercent: number;
  trailing4WeekTotalTime: number;
  trailing4WeekTimePercent: number;
  totalTimeAllTime: number;
  progressTo10kHours: number;
};

/** Seconds counted toward history time totals (elapsed wall time for the sit). */
export function sessionTimeSeconds(session: HistorySessionTimeInput): number {
  return session.actualTime ?? session.duration;
}

/**
 * Trailing 4-week and all-time stats for the History view (#83).
 * `todayIso` should match the client's local calendar day (same convention as
 * `sessionDate` stamping) so the window ends on the user's "today".
 */
export function calculateHistoryPeriodStats(
  sessions: HistorySessionTimeInput[],
  todayIso: string,
): HistoryPeriodStats {
  const periodStart = addDaysToIsoDate(todayIso, -(TRAILING_4_WEEK_DAYS - 1));
  const datesInPeriod = new Set<string>();
  let trailing4WeekTotalTime = 0;
  let totalTimeAllTime = 0;

  for (const session of sessions) {
    if (!isValidSessionCalendarDate(session.sessionDate)) continue;
    const secs = sessionTimeSeconds(session);
    totalTimeAllTime += secs;
    if (session.sessionDate! >= periodStart && session.sessionDate! <= todayIso) {
      datesInPeriod.add(session.sessionDate!);
      trailing4WeekTotalTime += secs;
    }
  }

  const trailing4WeekDays = datesInPeriod.size;
  const trailing4WeekDayPercent = parseFloat(
    ((trailing4WeekDays / TRAILING_4_WEEK_DAYS) * 100).toFixed(1),
  );
  const trailing4WeekTimePercent = parseFloat(
    ((trailing4WeekTotalTime / SECONDS_IN_4_WEEKS) * 100).toFixed(2),
  );
  const progressTo10kHours = parseFloat(
    ((totalTimeAllTime / TEN_THOUSAND_HOURS_SECONDS) * 100).toFixed(2),
  );

  return {
    trailing4WeekDays,
    trailing4WeekDayPercent,
    trailing4WeekTotalTime,
    trailing4WeekTimePercent,
    totalTimeAllTime,
    progressTo10kHours,
  };
}
