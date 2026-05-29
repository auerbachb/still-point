/**
 * Buddy shared-session calendar queries (#350).
 *
 * iOS parity: mirror these session-list queries against the same REST endpoints:
 * - `GET /api/buddy/sessions/calendar` — unified multi-buddy calendar (`listBuddyCalendarSessions`)
 * - `GET /api/buddy/sessions/calendar/[buddyId]` — per-buddy drill-down (`listBuddyCalendarSessionsForBuddy`)
 *
 * Default window: last {@link BUDDY_CALENDAR_DEFAULT_DAYS} calendar days (#83-style scope).
 * Per-buddy views include only shared sits (not the other person's solo history).
 */
import { db } from "@/db";
import {
  buddySessions,
  buddySessionParticipants,
  friendships,
  users,
} from "@/db/schema";
import { orderedUserPair, isUuid } from "@/lib/friends";
import {
  addDaysToIsoDate,
  isValidSessionCalendarDate,
} from "@/lib/sessionCalendar";
import { and, eq, inArray } from "drizzle-orm";

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

const BUDDY_CALENDAR_PALETTE = [
  "#5B8C7A",
  "#7A6B8C",
  "#8C7A5B",
  "#5B6F8C",
  "#8C5B6B",
  "#6B8C5B",
  "#8C6B5B",
  "#5B8C8C",
] as const;

/** Deterministic accent color from buddy user id (stable across unified + per-buddy views). */
export function buddyColorFromUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return BUDDY_CALENDAR_PALETTE[hash % BUDDY_CALENDAR_PALETTE.length];
}

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

  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "200", 10);
  const offsetRaw = Number.parseInt(searchParams.get("offset") ?? "0", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), BUDDY_CALENDAR_MAX_LIMIT)
    : 200;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  return { fromDate, toDate, limit, offset };
}

async function assertFriendship(userId: string, buddyId: string): Promise<boolean> {
  if (!isUuid(buddyId) || buddyId === userId) return false;
  const [u1, u2] = orderedUserPair(userId, buddyId);
  const [row] = await db
    .select({ user1Id: friendships.user1Id })
    .from(friendships)
    .where(and(eq(friendships.user1Id, u1), eq(friendships.user2Id, u2)))
    .limit(1);
  return Boolean(row);
}

type SessionRow = {
  id: string;
  state: string;
  durationSeconds: number;
  scheduledStartAt: Date | null;
  startedAt: Date | null;
  createdAt: Date;
  participantUserId: string;
  username: string;
};

async function fetchParticipantRows(
  viewerUserId: string,
  buddyIdFilter: string | null,
): Promise<SessionRow[]> {
  const viewerSessionIds = db
    .select({ id: buddySessionParticipants.buddySessionId })
    .from(buddySessionParticipants)
    .where(eq(buddySessionParticipants.userId, viewerUserId));

  const conditions = [inArray(buddySessions.id, viewerSessionIds)];

  if (buddyIdFilter) {
    const buddySessionIds = db
      .select({ id: buddySessionParticipants.buddySessionId })
      .from(buddySessionParticipants)
      .where(eq(buddySessionParticipants.userId, buddyIdFilter));
    conditions.push(inArray(buddySessions.id, buddySessionIds));
  }

  return db
    .select({
      id: buddySessions.id,
      state: buddySessions.state,
      durationSeconds: buddySessions.durationSeconds,
      scheduledStartAt: buddySessions.scheduledStartAt,
      startedAt: buddySessions.startedAt,
      createdAt: buddySessions.createdAt,
      participantUserId: buddySessionParticipants.userId,
      username: users.username,
    })
    .from(buddySessions)
    .innerJoin(
      buddySessionParticipants,
      eq(buddySessions.id, buddySessionParticipants.buddySessionId),
    )
    .innerJoin(users, eq(buddySessionParticipants.userId, users.id))
    .where(and(...conditions));
}

function assembleSessions(
  rows: SessionRow[],
  viewerUserId: string,
  fromDate: string,
  toDate: string,
): BuddyCalendarSession[] {
  const byId = new Map<string, BuddyCalendarSession & { sortTs: number }>();

  for (const row of rows) {
    const calendarDate = buddySessionCalendarDate(row);
    if (calendarDate < fromDate || calendarDate > toDate) continue;

    let entry = byId.get(row.id);
    if (!entry) {
      const sortTs = (
        row.startedAt ??
        row.scheduledStartAt ??
        row.createdAt
      ).getTime();
      entry = {
        id: row.id,
        state: row.state,
        durationSeconds: row.durationSeconds,
        calendarDate,
        scheduledStartAt: row.scheduledStartAt?.toISOString() ?? null,
        startedAt: row.startedAt?.toISOString() ?? null,
        participants: [],
        buddyIds: [],
        sortTs,
      };
      byId.set(row.id, entry);
    }

    if (!entry.participants.some((p) => p.userId === row.participantUserId)) {
      entry.participants.push({
        userId: row.participantUserId,
        username: row.username,
      });
    }
  }

  const sessions: BuddyCalendarSession[] = [];
  for (const entry of byId.values()) {
    entry.buddyIds = entry.participants
      .map((p) => p.userId)
      .filter((id) => id !== viewerUserId);
    const { sortTs: _sortTs, ...rest } = entry;
    sessions.push(rest);
  }

  sessions.sort((a, b) => {
    if (a.calendarDate !== b.calendarDate) {
      return b.calendarDate.localeCompare(a.calendarDate);
    }
    const aTs = a.startedAt ?? a.scheduledStartAt ?? "";
    const bTs = b.startedAt ?? b.scheduledStartAt ?? "";
    return bTs.localeCompare(aTs);
  });

  return sessions;
}

/**
 * Unified buddy calendar: all shared sessions for the viewer in `[fromDate, toDate]`.
 * Powers `GET /api/buddy/sessions/calendar`.
 */
export async function listBuddyCalendarSessions(
  viewerUserId: string,
  range: { fromDate: string; toDate: string; limit: number; offset: number },
): Promise<BuddyCalendarListResult> {
  const rows = await fetchParticipantRows(viewerUserId, null);
  const filtered = assembleSessions(rows, viewerUserId, range.fromDate, range.toDate);
  const slice = filtered.slice(range.offset, range.offset + range.limit);
  const hasMore = range.offset + slice.length < filtered.length;

  return {
    sessions: slice,
    fromDate: range.fromDate,
    toDate: range.toDate,
    hasMore,
  };
}

/**
 * Per-buddy drill-down: shared sessions with `buddyId` only.
 * Powers `GET /api/buddy/sessions/calendar/[buddyId]`.
 */
export async function listBuddyCalendarSessionsForBuddy(
  viewerUserId: string,
  buddyId: string,
  range: { fromDate: string; toDate: string; limit: number; offset: number },
): Promise<BuddyCalendarListResult | { error: "NOT_FRIEND" | "INVALID_BUDDY" }> {
  if (!isUuid(buddyId) || buddyId === viewerUserId) {
    return { error: "INVALID_BUDDY" };
  }
  const isFriend = await assertFriendship(viewerUserId, buddyId);
  if (!isFriend) {
    return { error: "NOT_FRIEND" };
  }

  const rows = await fetchParticipantRows(viewerUserId, buddyId);
  const filtered = assembleSessions(rows, viewerUserId, range.fromDate, range.toDate);
  const slice = filtered.slice(range.offset, range.offset + range.limit);
  const hasMore = range.offset + slice.length < filtered.length;

  return {
    sessions: slice,
    fromDate: range.fromDate,
    toDate: range.toDate,
    hasMore,
  };
}
