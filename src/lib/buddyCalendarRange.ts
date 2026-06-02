import {
  addDaysToIsoDate,
  isValidSessionCalendarDate,
} from "@/lib/sessionCalendar";

/** Default lookback for buddy calendar APIs (matches #83-style history windows). */
export const BUDDY_CALENDAR_DEFAULT_DAYS = 90;

export const BUDDY_CALENDAR_MAX_LIMIT = 500;

export type BuddyCalendarParticipant = {
  userId: string;
  username: string;
};

export type BuddyCalendarSession = {
  id: string;
  state: string;
  durationSeconds: number;
  /** ISO `YYYY-MM-DD` placement date for the calendar row. */
  calendarDate: string;
  scheduledStartAt: string | null;
  startedAt: string | null;
  participants: BuddyCalendarParticipant[];
  /** Co-participant user ids excluding the viewer (for filters / color chips). */
  buddyIds: string[];
};

export type BuddyCalendarListResult = {
  sessions: BuddyCalendarSession[];
  fromDate: string;
  toDate: string;
  hasMore: boolean;
};

export function todayIsoDateUtc(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Pick calendar placement date: started → scheduled → created (UTC day). */
export function buddySessionCalendarDate(session: {
  startedAt: Date | null;
  scheduledStartAt: Date | null;
  createdAt: Date;
}): string {
  const ts = session.startedAt ?? session.scheduledStartAt ?? session.createdAt;
  const y = ts.getUTCFullYear();
  const m = String(ts.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ts.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseBuddyCalendarRange(searchParams: URLSearchParams): {
  fromDate: string;
  toDate: string;
  limit: number;
  offset: number;
} {
  const toDate =
    searchParams.get("to")?.trim() ||
    searchParams.get("toDate")?.trim() ||
    todayIsoDateUtc();
  if (!isValidSessionCalendarDate(toDate)) {
    throw new Error("INVALID_TO_DATE");
  }

  const fromParam = searchParams.get("from")?.trim() || searchParams.get("fromDate")?.trim();
  const fromDate = fromParam
    ? fromParam
    : addDaysToIsoDate(toDate, -(BUDDY_CALENDAR_DEFAULT_DAYS - 1));
  if (!isValidSessionCalendarDate(fromDate)) {
    throw new Error("INVALID_FROM_DATE");
  }

  if (fromDate > toDate) {
    throw new Error("INVALID_DATE_RANGE");
  }

  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "200", 10);
  const offsetRaw = Number.parseInt(searchParams.get("offset") ?? "0", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), BUDDY_CALENDAR_MAX_LIMIT)
    : 200;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  return { fromDate, toDate, limit, offset };
}
