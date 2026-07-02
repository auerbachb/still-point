import { addDaysToIsoDate, isValidSessionCalendarDate } from "./sessionCalendar";

export const BASE_DURATION = 60;
export const QUICK_DURATION = 60;
export const INCREMENT = 10;
export const BLOCK_DURATION = 10;
/** #240: a standard sit tops out at ten minutes. The primary track reaches this
 *  cap on `FORK_DAY` and then holds steady — the "10-minute track" the dual-track
 *  fork keeps while a second track ramps up alongside it. */
export const MAX_DURATION = 600;
/** #240: the day a standard sit first reaches the 10-minute cap (60 + 54·10 = 600).
 *  Derived so it stays correct if the base/increment/cap ever change. */
export const FORK_DAY = (MAX_DURATION - BASE_DURATION) / INCREMENT + 1;
const SESSION_TYPES = ["standard", "quick", "breath"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

/** #240: which daily progression a standard sit belongs to. `primary` is the
 *  original (now 10-minute-capped) track; `second` is the opt-in track that
 *  restarts at one minute and ramps +10s/day alongside it. */
const TRACKS = ["primary", "second"] as const;
export type Track = (typeof TRACKS)[number];

export function isTrack(value: unknown): value is Track {
  return typeof value === "string" && TRACKS.includes(value as Track);
}

/** Missing/absent track defaults to `primary` so pre-#240 clients (and rows) keep working. */
export function parseOptionalTrack(value: unknown): Track | null {
  if (value === undefined || value === null) {
    return "primary";
  }
  return isTrack(value) ? value : null;
}

export type SessionStatsInput = {
  sessionType?: string;
  dayNumber: number;
  duration: number;
  /** Extension seconds beyond `duration` from +1/+5 controls (#90). */
  bonusSeconds?: number;
  completed: boolean;
  clearPercent: number;
  thoughtCount: number;
  /** When set, streak counts unique calendar days (consecutive `sessionDate`s with a completed standard sit). */
  sessionDate?: string;
  createdAt?: Date | string;
};

export function isSessionType(value: unknown): value is SessionType {
  return typeof value === "string" && SESSION_TYPES.includes(value as SessionType);
}

export function parseOptionalSessionType(value: unknown): SessionType | null {
  if (value === undefined || value === null) {
    return "standard";
  }
  return isSessionType(value) ? value : null;
}

export function parseCompleted(value: unknown): boolean | null {
  if (value === undefined || value === null) {
    return true;
  }
  return typeof value === "boolean" ? value : null;
}

export function durationForDay(dayNumber: number): number {
  // #240: cap at ten minutes. Both tracks share this function, so each one holds
  // at 10 minutes once it reaches FORK_DAY instead of growing without bound.
  return Math.min(MAX_DURATION, BASE_DURATION + (Math.max(dayNumber, 1) - 1) * INCREMENT);
}

export function durationForSession(sessionType: SessionType, dayNumber: number): number {
  return sessionType === "quick" ? QUICK_DURATION : durationForDay(dayNumber);
}

export function shouldAdvanceDay(sessionType: SessionType, completed: boolean): boolean {
  return completed && sessionType === "standard";
}

export function calculateSessionStats(sessions: SessionStatsInput[]) {
  const standardSessions = sessions.filter(s => s.sessionType === undefined || s.sessionType === "standard");
  const completedSessions = standardSessions.filter(s => s.completed);
  const totalSessions = standardSessions.length;

  let streak = 0;
  const allHaveSessionDate = standardSessions.length > 0
    && standardSessions.every(s => isValidSessionCalendarDate(s.sessionDate));

  if (allHaveSessionDate) {
    const completedCalendarDates = new Set<string>();
    for (const session of standardSessions) {
      if (session.completed && session.sessionDate) {
        completedCalendarDates.add(session.sessionDate);
      }
    }
    let latestCal = "";
    for (const session of standardSessions) {
      if (session.sessionDate && session.sessionDate > latestCal) {
        latestCal = session.sessionDate;
      }
    }
    const latestDayHasCompletion = standardSessions.some(
      s => s.sessionDate === latestCal && s.completed,
    );
    if (!latestCal || !latestDayHasCompletion) {
      streak = 0;
    } else {
      let cursor = latestCal;
      while (completedCalendarDates.has(cursor)) {
        streak++;
        const next = addDaysToIsoDate(cursor, -1);
        if (next === cursor) break;
        cursor = next;
      }
    }
  } else {
    const completedByDay = new Map<number, boolean>();
    for (const session of standardSessions) {
      completedByDay.set(
        session.dayNumber,
        (completedByDay.get(session.dayNumber) ?? false) || session.completed,
      );
    }
    const maxDay = Math.max(0, ...completedByDay.keys());
    for (let day = maxDay; day >= 1; day--) {
      if (completedByDay.get(day) === true) {
        streak++;
      } else {
        break;
      }
    }
  }

  const avgClearPercent = completedSessions.length > 0
    ? Math.round(completedSessions.reduce((sum, s) => sum + s.clearPercent, 0) / completedSessions.length)
    : 0;

  const avgThoughtsPerSession = totalSessions > 0
    ? parseFloat((standardSessions.reduce((sum, s) => sum + s.thoughtCount, 0) / totalSessions).toFixed(1))
    : 0;

  const avgThoughtsPerMinute = totalSessions > 0
    ? parseFloat((standardSessions.reduce((sum, s) => {
        const bonus = s.bonusSeconds ?? 0;
        const minutes = (s.duration + bonus) / 60;
        return sum + (minutes > 0 ? s.thoughtCount / minutes : 0);
      }, 0) / totalSessions).toFixed(1))
    : 0;

  const bonusSecondsTotal = standardSessions.reduce((sum, s) => sum + (s.bonusSeconds ?? 0), 0);

  return {
    streak,
    avgClearPercent,
    avgThoughtsPerSession,
    avgThoughtsPerMinute,
    bonusSecondsTotal,
  };
}
