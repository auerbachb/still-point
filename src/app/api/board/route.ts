import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, sessions } from "@/db/schema";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { calculateSessionStats } from "@/lib/constants";
import { eq, desc, and, inArray } from "drizzle-orm";

export const GET = withApiHandler("Board", async () => {
  // Get all public users
  const publicUsers = await db.select({
    id: users.id,
    username: users.username,
    currentDay: users.currentDay,
  })
    .from(users)
    .where(eq(users.isPublic, true))
    .orderBy(desc(users.currentDay))
    .limit(50);

  const userIds = publicUsers.map((u) => u.id);
  const allSessions = userIds.length > 0
    ? await db.select({
        userId: sessions.userId,
        dayNumber: sessions.dayNumber,
        sessionType: sessions.sessionType,
        duration: sessions.duration,
        bonusSeconds: sessions.bonusSeconds,
        completed: sessions.completed,
        clearPercent: sessions.clearPercent,
        thoughtCount: sessions.thoughtCount,
        sessionDate: sessions.sessionDate,
      })
        .from(sessions)
        .where(and(inArray(sessions.userId, userIds), eq(sessions.sessionType, "standard")))
        .orderBy(desc(sessions.dayNumber))
    : [];

  const sessionsByUser = new Map<string, typeof allSessions>();
  for (const session of allSessions) {
    const existing = sessionsByUser.get(session.userId);
    if (existing) {
      existing.push(session);
    } else {
      sessionsByUser.set(session.userId, [session]);
    }
  }

  // Compute stats per public user from the pre-fetched session map
  const board = publicUsers.map((user) => {
    const userSessions = sessionsByUser.get(user.id) ?? [];
    const stats = calculateSessionStats(userSessions);
    const totalSessions = userSessions.filter(s => s.completed).length;

    return {
      username: user.username,
      currentDay: user.currentDay,
      streak: stats.streak,
      avgClear: stats.avgClearPercent,
      totalSessions,
    };
  });

  return NextResponse.json({ board });
});
