import { NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessionParticipants, friendships, sessions, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { and, eq, isNotNull, ne, or, sql } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const uid = auth.userId;

    const friendSelect = { id: users.id, username: users.username };

    const asUser1 = db
      .select(friendSelect)
      .from(friendships)
      .innerJoin(users, eq(friendships.user2Id, users.id))
      .where(eq(friendships.user1Id, uid));

    const asUser2 = db
      .select(friendSelect)
      .from(friendships)
      .innerJoin(users, eq(friendships.user1Id, users.id))
      .where(eq(friendships.user2Id, uid));

    // #343: "most meditated with" per friend. Joins the current user's own
    // completed `sessions` rows created from shared buddy sits (see
    // record-personal-session/route.ts) against `buddy_session_participants`
    // on the same `buddy_session_id` to find the other participant, then
    // aggregates per friend.
    //
    // The friendships table enforces user1Id < user2Id, so a friend can appear
    // in either column. We join against friendships to restrict aggregation to
    // actual friends, avoiding work for non-friend participants.
    const meditatedWithSelect = db
      .select({
        friendId: buddySessionParticipants.userId,
        sessionCount: sql<number>`count(distinct ${sessions.id})`.mapWith(Number),
        totalDurationSeconds: sql<number>`coalesce(sum(coalesce(${sessions.actualTime}, ${sessions.duration})), 0)`.mapWith(Number),
      })
      .from(sessions)
      .innerJoin(
        buddySessionParticipants,
        eq(buddySessionParticipants.buddySessionId, sessions.buddySessionId),
      )
      .innerJoin(
        friendships,
        or(
          and(eq(friendships.user1Id, uid), eq(friendships.user2Id, buddySessionParticipants.userId)),
          and(eq(friendships.user2Id, uid), eq(friendships.user1Id, buddySessionParticipants.userId)),
        ),
      )
      .where(
        and(
          eq(sessions.userId, uid),
          eq(sessions.completed, true),
          isNotNull(sessions.buddySessionId),
          ne(buddySessionParticipants.userId, uid),
        ),
      )
      .groupBy(buddySessionParticipants.userId);

    const [rows, meditatedWith] = await Promise.all([
      asUser1.union(asUser2),
      meditatedWithSelect,
    ]);

    const statsByFriendId = new Map(
      meditatedWith.map((row) => [
        row.friendId,
        { sessionCount: row.sessionCount, totalDurationSeconds: row.totalDurationSeconds },
      ]),
    );

    const friends = rows
      .map((row) => {
        const stats = statsByFriendId.get(row.id) ?? { sessionCount: 0, totalDurationSeconds: 0 };
        return { ...row, ...stats };
      })
      .sort((a, b) => {
        if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount;
        if (b.totalDurationSeconds !== a.totalDurationSeconds) {
          return b.totalDurationSeconds - a.totalDurationSeconds;
        }
        return a.username.localeCompare(b.username);
      });

    return NextResponse.json({ friends });
  } catch (error) {
    console.error("Friends list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
