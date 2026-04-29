import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { calculateSessionStats, parseCompleted, parseOptionalSessionType, shouldAdvanceDay } from "@/lib/constants";
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
    const stats = calculateSessionStats(userSessions);

    return NextResponse.json({
      sessions: userSessions,
      stats,
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
    const { dayNumber, duration, actualTime, clearPercent, thoughtCount, mindStateLog, sessionDate } = body;
    const completed = parseCompleted(body.completed);
    const sessionType = parseOptionalSessionType(body.sessionType);

    if (!dayNumber || !duration || clearPercent === undefined || !sessionDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (completed === null) {
      return NextResponse.json({ error: "Invalid completed value" }, { status: 400 });
    }
    if (!sessionType) {
      return NextResponse.json({ error: "Invalid session type" }, { status: 400 });
    }

    const [session] = await db.insert(sessions).values({
      userId: auth.userId,
      dayNumber,
      sessionType,
      duration,
      completed,
      actualTime: actualTime ?? duration,
      clearPercent,
      thoughtCount: thoughtCount ?? 0,
      mindStateLog: mindStateLog ?? [],
      sessionDate,
    }).returning();

    // Quick sessions are extra practice and do not advance the daily progression.
    if (shouldAdvanceDay(sessionType, completed)) {
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
