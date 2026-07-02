import { addDaysToIsoDate, isValidSessionCalendarDate } from "./sessionCalendar";
import { TRAILING_4_WEEK_DAYS } from "./historyStats";
import {
  computeMindStateCompositionFromLog,
  type MindStateCompositionSeconds,
} from "./mindStateSession";

export type MindStateTrendSessionInput = {
  sessionDate?: string;
  actualTime?: number | null;
  duration: number;
  mindStateLog?: Array<{ time: number; state: string }> | null;
};

export type MindStateCompositionPercents = {
  clearPercent: number;
  lightDistractionPercent: number;
  heavyDistractionPercent: number;
  hyperfocusPercent: number;
};

export type MindStateDailyTrendBucket = {
  date: string;
  totalSitSeconds: number;
  composition: MindStateCompositionPercents;
};

export type MindStateTrendStats = {
  trailing4Week: MindStateCompositionPercents & { totalSitSeconds: number };
  allTime: MindStateCompositionPercents & { totalSitSeconds: number };
  /** One bucket per calendar day in the trailing window (oldest first). */
  dailyTrend: MindStateDailyTrendBucket[];
};

function sessionEndTime(session: MindStateTrendSessionInput): number {
  return Math.max(session.actualTime ?? session.duration, 0);
}

function emptyComposition(): MindStateCompositionSeconds {
  return {
    clearSeconds: 0,
    lightDistractionSeconds: 0,
    heavyDistractionSeconds: 0,
    hyperfocusSeconds: 0,
    totalSeconds: 0,
  };
}

function addComposition(target: MindStateCompositionSeconds, next: MindStateCompositionSeconds): void {
  target.clearSeconds += next.clearSeconds;
  target.lightDistractionSeconds += next.lightDistractionSeconds;
  target.heavyDistractionSeconds += next.heavyDistractionSeconds;
  target.hyperfocusSeconds += next.hyperfocusSeconds;
  target.totalSeconds += next.totalSeconds;
}

function compositionPercents(composition: MindStateCompositionSeconds): MindStateCompositionPercents {
  const denom = Math.max(composition.totalSeconds, 1);
  const toPercent = (seconds: number) => parseFloat(((seconds / denom) * 100).toFixed(1));
  return {
    clearPercent: toPercent(composition.clearSeconds),
    lightDistractionPercent: toPercent(composition.lightDistractionSeconds),
    heavyDistractionPercent: toPercent(composition.heavyDistractionSeconds),
    hyperfocusPercent: toPercent(composition.hyperfocusSeconds),
  };
}

function compositionForSession(session: MindStateTrendSessionInput): MindStateCompositionSeconds {
  const endTime = sessionEndTime(session);
  const log = Array.isArray(session.mindStateLog) ? session.mindStateLog : [];
  return computeMindStateCompositionFromLog(log, endTime);
}

/**
 * Aggregates sit-time composition from persisted `mindStateLog` rows for History trends (#182).
 */
export function calculateMindStateTrendStats(
  sessions: MindStateTrendSessionInput[],
  todayIso: string,
): MindStateTrendStats {
  const periodStart = addDaysToIsoDate(todayIso, -(TRAILING_4_WEEK_DAYS - 1));
  const trailingTotals = emptyComposition();
  const allTimeTotals = emptyComposition();
  const dailyTotals = new Map<string, MindStateCompositionSeconds>();

  for (let i = 0; i < TRAILING_4_WEEK_DAYS; i++) {
    dailyTotals.set(addDaysToIsoDate(periodStart, i), emptyComposition());
  }

  for (const session of sessions) {
    if (!isValidSessionCalendarDate(session.sessionDate)) continue;
    const composition = compositionForSession(session);
    if (composition.totalSeconds <= 0) continue;

    addComposition(allTimeTotals, composition);

    if (session.sessionDate! >= periodStart && session.sessionDate! <= todayIso) {
      addComposition(trailingTotals, composition);
      const dayBucket = dailyTotals.get(session.sessionDate!);
      if (dayBucket) addComposition(dayBucket, composition);
    }
  }

  const dailyTrend: MindStateDailyTrendBucket[] = [];
  for (let i = 0; i < TRAILING_4_WEEK_DAYS; i++) {
    const date = addDaysToIsoDate(periodStart, i);
    const totals = dailyTotals.get(date) ?? emptyComposition();
    dailyTrend.push({
      date,
      totalSitSeconds: totals.totalSeconds,
      composition: compositionPercents(totals),
    });
  }

  return {
    trailing4Week: {
      totalSitSeconds: trailingTotals.totalSeconds,
      ...compositionPercents(trailingTotals),
    },
    allTime: {
      totalSitSeconds: allTimeTotals.totalSeconds,
      ...compositionPercents(allTimeTotals),
    },
    dailyTrend,
  };
}
