import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, sessions } from "@/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";

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
        completed: sessions.completed,
        clearPercent: sessions.clearPercent,
        sessionDate: sessions.sessionDate,
      })
        .from(sessions)
        .where(eq(sessions.userId, user.id))
        .orderBy(desc(sessions.dayNumber));

      const completedSessions = userSessions.filter(s => s.completed);
      const totalSessions = completedSessions.length;

      // Streak: consecutive completed sessions from the latest
      let streak = 0;
      for (const s of userSessions) {
        if (s.completed) {
          streak++;
        } else {
          break;
        }
      }

      const avgClear = totalSessions > 0
        ? Math.round(completedSessions.reduce((sum, s) => sum + s.clearPercent, 0) / totalSessions)
        : 0;

      return {
        username: user.username,
        currentDay: user.currentDay,
        streak,
        avgClear,
        totalSessions,
      };
    }));

    return NextResponse.json({ board });
  } catch (error) {
    console.error("Board error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
