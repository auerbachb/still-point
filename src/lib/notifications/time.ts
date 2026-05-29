const HH_MM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeOfDay(value: string): boolean {
  return HH_MM_PATTERN.test(value);
}

export function isValidIanaTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** User-local calendar date as YYYY-MM-DD. */
export function localCalendarDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Minutes since local midnight in the user's timezone. */
export function localMinutesSinceMidnight(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function parseTimeOfDayToMinutes(value: string): number {
  const match = HH_MM_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid time of day: ${value}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** True when `now` falls in the cron tick window for the user's reminder time. */
export function isReminderDueNow(params: {
  now: Date;
  timeZone: string;
  reminderTime: string;
  tickWindowMinutes?: number;
}): boolean {
  const window = params.tickWindowMinutes ?? 5;
  const target = parseTimeOfDayToMinutes(params.reminderTime);
  const current = localMinutesSinceMidnight(params.now, params.timeZone);
  return current >= target && current < target + window;
}

export function addCalendarDays(isoDate: string, deltaDays: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return utc.toISOString().slice(0, 10);
}

export function isInQuietHours(params: {
  now: Date;
  timeZone: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}): boolean {
  const { quietHoursStart, quietHoursEnd } = params;
  if (!quietHoursStart || !quietHoursEnd) return false;
  if (!isValidTimeOfDay(quietHoursStart) || !isValidTimeOfDay(quietHoursEnd)) return false;

  const start = parseTimeOfDayToMinutes(quietHoursStart);
  const end = parseTimeOfDayToMinutes(quietHoursEnd);
  const current = localMinutesSinceMidnight(params.now, params.timeZone);

  if (start === end) return false;
  if (start < end) {
    return current >= start && current < end;
  }
  // Window spans local midnight (e.g. 22:00–07:00).
  return current >= start || current < end;
}

/** ISO weekday in user's timezone: 1 = Monday … 7 = Sunday. */
export function localIsoWeekday(now: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[weekday] ?? 1;
}

export function frequencyAllowsSendToday(params: {
  frequency: string;
  now: Date;
  timeZone: string;
}): boolean {
  const weekday = localIsoWeekday(params.now, params.timeZone);
  switch (params.frequency) {
    case "daily":
      return true;
    case "every_other_day":
      // Stable cadence keyed to ISO weekday parity in the user's TZ.
      return weekday % 2 === 1;
    case "weekly":
      return weekday === 1;
    default:
      return false;
  }
}
