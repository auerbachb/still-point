const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeFormat(time: string): boolean {
  return HH_MM.test(time);
}

export function parseTimeToMinutes(time: string): number {
  const match = HH_MM.exec(time);
  if (!match) {
    throw new Error(`Invalid time: ${time}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Local calendar date `YYYY-MM-DD` in the given IANA timezone. */
export function getLocalCalendarDate(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Local clock time `HH:mm` (24h) in the given IANA timezone. */
export function getLocalTimeString(timezone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

/** Local weekday 0=Sunday … 6=Saturday in the given IANA timezone. */
export function getLocalWeekday(timezone: string, at: Date = new Date()): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(at);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday] ?? 0;
}

export function getLocalMinutesSinceMidnight(timezone: string, at: Date = new Date()): number {
  return parseTimeToMinutes(getLocalTimeString(timezone, at));
}

/** True when `at` falls on the same local calendar day as `sentAt` in `timezone`. */
export function wasSentOnLocalCalendarDay(
  sentAt: Date | null | undefined,
  timezone: string,
  at: Date = new Date(),
): boolean {
  if (!sentAt) return false;
  return getLocalCalendarDate(timezone, sentAt) === getLocalCalendarDate(timezone, at);
}

/**
 * True when the user's preferred reminder time falls in the current scheduler tick window.
 * Cron should run every `tickMinutes` (default 5).
 */
export function isPreferredTimeDue(
  preferredTime: string,
  timezone: string,
  tickMinutes: number,
  at: Date = new Date(),
): boolean {
  const preferred = parseTimeToMinutes(preferredTime);
  const current = getLocalMinutesSinceMidnight(timezone, at);
  return current >= preferred && current < preferred + tickMinutes;
}

/**
 * True when local clock time is inside quiet hours. Supports overnight windows (e.g. 22:00–07:00).
 */
export function isWithinQuietHours(
  quietHoursStart: string | null | undefined,
  quietHoursEnd: string | null | undefined,
  timezone: string,
  at: Date = new Date(),
): boolean {
  if (!quietHoursStart || !quietHoursEnd) return false;
  if (!isValidTimeFormat(quietHoursStart) || !isValidTimeFormat(quietHoursEnd)) return false;

  const current = getLocalMinutesSinceMidnight(timezone, at);
  const start = parseTimeToMinutes(quietHoursStart);
  const end = parseTimeToMinutes(quietHoursEnd);

  if (start === end) return false;
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}
