import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, desc, and, sql } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userSessions = await db.select()
      .from(sessions)
      .where(eq(sessions.userId, auth.userId))
      .orderBy(desc(sessions.dayNumber));

    // Compute stats
    const completedSessions = userSessions.filter(s => s.completed);
    const totalSessions = userSessions.length;

    // Streak: count consecutive completed sessions backward from latest day
    let streak = 0;
    const sortedByDay = [...userSessions].sort((a, b) => b.dayNumber - a.dayNumber);
    for (const s of sortedByDay) {
      if (s.completed) {
        streak++;
      } else {
        break;
      }
    }

    const avgClearPercent = completedSessions.length > 0
      ? Math.round(completedSessions.reduce((sum, s) => sum + s.clearPercent, 0) / completedSessions.length)
      : 0;

    const avgThoughtsPerSession = totalSessions > 0
      ? parseFloat((userSessions.reduce((sum, s) => sum + s.thoughtCount, 0) / totalSessions).toFixed(1))
      : 0;

    const avgThoughtsPerMinute = totalSessions > 0
      ? parseFloat((userSessions.reduce((sum, s) => {
          const minutes = s.duration / 60;
          return sum + (minutes > 0 ? s.thoughtCount / minutes : 0);
        }, 0) / totalSessions).toFixed(1))
      : 0;

    return NextResponse.json({
      sessions: userSessions,
      stats: {
        streak,
        avgClearPercent,
        avgThoughtsPerSession,
        avgThoughtsPerMinute,
      },
    });
  } catch (error) {
    console.error("Get sessions error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { dayNumber, duration, completed, actualTime, clearPercent, thoughtCount, mindStateLog, sessionDate } = body;

    if (!dayNumber || !duration || clearPercent === undefined || !sessionDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [session] = await db.insert(sessions).values({
      userId: auth.userId,
      dayNumber,
      duration,
      completed: completed ?? true,
      actualTime: actualTime ?? duration,
      clearPercent,
      thoughtCount: thoughtCount ?? 0,
      mindStateLog: mindStateLog ?? [],
      sessionDate,
    }).returning();

    // Increment currentDay if session was completed
    if (completed) {
      await db.update(users)
        .set({
          currentDay: sql`${users.currentDay} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, auth.userId));
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error("Create session error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
