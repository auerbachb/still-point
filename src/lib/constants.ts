export const BASE_DURATION = 60;
export const QUICK_DURATION = 60;
export const INCREMENT = 10;
export const BLOCK_DURATION = 10;
export const SESSION_TYPES = ["standard", "quick"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export type SessionStatsInput = {
  sessionType?: string;
  dayNumber: number;
  duration: number;
  completed: boolean;
  clearPercent: number;
  thoughtCount: number;
  sessionDate?: string;
  createdAt?: Date | string;
};

export function isSessionType(value: unknown): value is SessionType {
  return typeof value === "string" && SESSION_TYPES.includes(value as SessionType);
}

export function resolveSessionType(value: unknown): SessionType {
  return value === undefined || value === null ? "standard" : isSessionType(value) ? value : "standard";
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
  return BASE_DURATION + (Math.max(dayNumber, 1) - 1) * INCREMENT;
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
  const seenDays = new Set<number>();
  const sortedByDay = [...standardSessions].sort((a, b) => {
    if (a.dayNumber !== b.dayNumber) {
      return b.dayNumber - a.dayNumber;
    }
    const aTime = sessionSortTime(a);
    const bTime = sessionSortTime(b);
    return bTime - aTime;
  });
  for (const session of sortedByDay) {
    if (seenDays.has(session.dayNumber)) {
      continue;
    }
    seenDays.add(session.dayNumber);
    if (session.completed) {
      streak++;
    } else {
      break;
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
        const minutes = s.duration / 60;
        return sum + (minutes > 0 ? s.thoughtCount / minutes : 0);
      }, 0) / totalSessions).toFixed(1))
    : 0;

  return {
    streak,
    avgClearPercent,
    avgThoughtsPerSession,
    avgThoughtsPerMinute,
  };
}

function sessionSortTime(session: SessionStatsInput): number {
  const raw = session.createdAt ?? session.sessionDate;
  if (!raw) {
    return 0;
  }
  const time = raw instanceof Date ? raw.getTime() : Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}
