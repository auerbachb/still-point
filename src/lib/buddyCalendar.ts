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
import "server-only";

import { db } from "@/db";
import {
  buddySessions,
  buddySessionParticipants,
  friendships,
  users,
} from "@/db/schema";
import { orderedUserPair, isUuid } from "@/lib/friends";
import {
  type BuddyCalendarListResult,
  type BuddyCalendarSession,
  buddySessionCalendarDate,
} from "@/lib/buddyCalendarRange";
import { and, eq, inArray, sql } from "drizzle-orm";

export {
  BUDDY_CALENDAR_DEFAULT_DAYS,
  BUDDY_CALENDAR_MAX_LIMIT,
  type BuddyCalendarListResult,
  type BuddyCalendarParticipant,
  type BuddyCalendarSession,
  buddySessionCalendarDate,
  parseBuddyCalendarRange,
  todayIsoDateUtc,
} from "@/lib/buddyCalendarRange";

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

function sessionPlacementDateSql() {
  return sql<string>`to_char(
    coalesce(
      ${buddySessions.startedAt},
      ${buddySessions.scheduledStartAt},
      ${buddySessions.createdAt}
    ) at time zone 'UTC',
    'YYYY-MM-DD'
  )`;
}

async function fetchParticipantRows(
  viewerUserId: string,
  buddyIdFilter: string | null,
  fromDate: string,
  toDate: string,
): Promise<SessionRow[]> {
  const placementDate = sessionPlacementDateSql();

  const viewerSessionIds = db
    .select({ id: buddySessionParticipants.buddySessionId })
    .from(buddySessionParticipants)
    .where(eq(buddySessionParticipants.userId, viewerUserId));

  const conditions = [
    inArray(buddySessions.id, viewerSessionIds),
    sql`${placementDate} >= ${fromDate}`,
    sql`${placementDate} <= ${toDate}`,
  ];

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

  const sessions: Array<BuddyCalendarSession & { sortTs: number }> = [];
  for (const entry of byId.values()) {
    entry.buddyIds = entry.participants
      .map((p) => p.userId)
      .filter((id) => id !== viewerUserId);
    sessions.push(entry);
  }

  sessions.sort((a, b) => {
    if (a.calendarDate !== b.calendarDate) {
      return b.calendarDate.localeCompare(a.calendarDate);
    }
    if (b.sortTs !== a.sortTs) return b.sortTs - a.sortTs;
    return b.id.localeCompare(a.id);
  });

  return sessions.map(({ sortTs: _sortTs, ...rest }) => rest);
}

/**
 * Unified buddy calendar: all shared sessions for the viewer in `[fromDate, toDate]`.
 * Powers `GET /api/buddy/sessions/calendar`.
 */
export async function listBuddyCalendarSessions(
  viewerUserId: string,
  range: { fromDate: string; toDate: string; limit: number; offset: number },
): Promise<BuddyCalendarListResult> {
  const rows = await fetchParticipantRows(
    viewerUserId,
    null,
    range.fromDate,
    range.toDate,
  );
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

  const rows = await fetchParticipantRows(
    viewerUserId,
    buddyId,
    range.fromDate,
    range.toDate,
  );
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
