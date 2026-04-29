import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, sessions } from "@/db/schema";
import { calculateSessionStats } from "@/lib/constants";
import { eq, desc, and } from "drizzle-orm";

export async function GET() {
  try {
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

    // For each public user, compute stats
    const board = await Promise.all(publicUsers.map(async (user) => {
      const userSessions = await db.select({
        dayNumber: sessions.dayNumber,
        sessionType: sessions.sessionType,
        duration: sessions.duration,
        completed: sessions.completed,
        clearPercent: sessions.clearPercent,
        thoughtCount: sessions.thoughtCount,
        sessionDate: sessions.sessionDate,
      })
        .from(sessions)
        .where(and(eq(sessions.userId, user.id), eq(sessions.sessionType, "standard")))
        .orderBy(desc(sessions.dayNumber));

      const stats = calculateSessionStats(userSessions);
      const totalSessions = userSessions.filter(s => s.completed).length;

      return {
        username: user.username,
        currentDay: user.currentDay,
        streak: stats.streak,
        avgClear: stats.avgClearPercent,
        totalSessions,
      };
    }));

    return NextResponse.json({ board });
  } catch (error) {
    console.error("Board error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
