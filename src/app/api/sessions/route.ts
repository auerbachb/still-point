import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { calculateSessionStats, parseCompleted, parseOptionalSessionType, shouldAdvanceDay } from "@/lib/constants";
import { advanceProgression } from "@/lib/duration";
import { eq, desc, and } from "drizzle-orm";

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
      stats: {
        ...stats,
        bonusMinutesTotal: Math.round(stats.bonusSecondsTotal / 60),
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
    const { dayNumber, duration, actualTime, clearPercent, thoughtCount, mindStateLog, sessionDate } = body;
    const completed = parseCompleted(body.completed);
    const sessionType = parseOptionalSessionType(body.sessionType);
    // #374: taps-per-breath count. Only persisted for breath sessions (so a stray
    // breathCount on a standard/quick payload can't violate the data contract), and
    // clamped to the Postgres integer range so an out-of-range value can't turn into
    // a 500 at insert time.
    const breathCountRaw = body.breathCount;
    const breathCount =
      sessionType === "breath" && typeof breathCountRaw === "number" && Number.isFinite(breathCountRaw)
        ? Math.min(2_147_483_647, Math.max(0, Math.floor(breathCountRaw)))
        : null;
    const bonusSecondsRaw = body.bonusSeconds;
    const bonusSeconds =
      typeof bonusSecondsRaw === "number" && Number.isFinite(bonusSecondsRaw)
        ? Math.max(0, Math.min(86_400, Math.floor(bonusSecondsRaw)))
        : 0;

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
      bonusSeconds,
      completed,
      actualTime: actualTime ?? duration,
      clearPercent,
      thoughtCount: thoughtCount ?? 0,
      breathCount,
      mindStateLog: mindStateLog ?? [],
      sessionDate,
    }).returning();

    // Quick sessions are extra practice and do not advance the daily progression.
    if (shouldAdvanceDay(sessionType, completed)) {
      const [current] = await db.select({
        currentDay: users.currentDay,
        recoveryTargetDay: users.recoveryTargetDay,
        recoveryCurrentStep: users.recoveryCurrentStep,
        recoveryTotalSteps: users.recoveryTotalSteps,
      }).from(users).where(eq(users.id, auth.userId)).limit(1);

      if (current) {
        // #238: while recovering, a completed sit steps the ramp forward instead of
        // bumping `currentDay` — see advanceProgression for the full rule.
        const next = advanceProgression(sessionType, completed, current);
        await db.update(users)
          .set({
            currentDay: next.currentDay,
            recoveryTargetDay: next.recoveryTargetDay,
            recoveryCurrentStep: next.recoveryCurrentStep,
            recoveryTotalSteps: next.recoveryTotalSteps,
            updatedAt: new Date(),
          })
          .where(eq(users.id, auth.userId));
      }
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error("Create session error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
