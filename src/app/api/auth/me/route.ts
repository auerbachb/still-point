import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { activeRecovery, detectMissedDayGap } from "@/lib/duration";
import { isValidSessionCalendarDate } from "@/lib/sessionCalendar";
import { and, desc, eq } from "drizzle-orm";

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [user] = await db.select({
      id: users.id,
      email: users.email,
      username: users.username,
      isPublic: users.isPublic,
      currentDay: users.currentDay,
      aphorismsEnabled: users.aphorismsEnabled,
      recoveryTargetDay: users.recoveryTargetDay,
      recoveryCurrentStep: users.recoveryCurrentStep,
      recoveryTotalSteps: users.recoveryTotalSteps,
      dualTrackEnabled: users.dualTrackEnabled,
      secondTrackDay: users.secondTrackDay,
    }).from(users).where(eq(users.id, auth.userId)).limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Missed-day recovery detection (#238): only worth checking when not already
    // recovering — an active ramp is left alone rather than restarted mid-stream.
    if (!activeRecovery(user)) {
      const requestedDate = request.nextUrl.searchParams.get("date");
      const todayIso = isValidSessionCalendarDate(requestedDate) ? requestedDate! : todayIsoUtc();

      const [lastSession] = await db.select({ sessionDate: sessions.sessionDate })
        .from(sessions)
        .where(and(
          eq(sessions.userId, auth.userId),
          eq(sessions.completed, true),
          eq(sessions.sessionType, "standard"),
          // #240: recovery tracks the primary track's currentDay, so a recent
          // second-track sit must not mask a gap since the last primary sit.
          eq(sessions.track, "primary"),
        ))
        .orderBy(desc(sessions.sessionDate))
        .limit(1);

      const recovery = detectMissedDayGap({
        lastCompletedSessionDate: lastSession?.sessionDate ?? null,
        todayIso,
        currentDay: user.currentDay,
        recovery: user,
      });

      if (recovery) {
        await db.update(users).set({
          recoveryTargetDay: recovery.recoveryTargetDay,
          recoveryCurrentStep: recovery.recoveryCurrentStep,
          recoveryTotalSteps: recovery.recoveryTotalSteps,
          updatedAt: new Date(),
        }).where(eq(users.id, auth.userId));

        user.recoveryTargetDay = recovery.recoveryTargetDay;
        user.recoveryCurrentStep = recovery.recoveryCurrentStep;
        user.recoveryTotalSteps = recovery.recoveryTotalSteps;
      }
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Auth me error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
