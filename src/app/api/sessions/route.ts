import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { atomicCreateSessionWithProgression } from "@/db/atomic";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { calculateSessionStats, parseCompleted, parseOptionalSessionType, parseOptionalTrack } from "@/lib/constants";
import { eq, desc } from "drizzle-orm";
import { sessions } from "@/db/schema";

export const GET = withApiHandler("Get sessions", async () => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const userSessions = await db.select()
    .from(sessions)
    .where(eq(sessions.userId, auth.user.userId))
    .orderBy(desc(sessions.dayNumber));
  const stats = calculateSessionStats(userSessions);

  return NextResponse.json({
    sessions: userSessions,
    stats: {
      ...stats,
      bonusMinutesTotal: Math.round(stats.bonusSecondsTotal / 60),
    },
  });
});

export const POST = withApiHandler("Create session", async (request: NextRequest) => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { dayNumber, duration, actualTime, clearPercent, thoughtCount, mindStateLog, sessionDate } = body;
  const completed = parseCompleted(body.completed);
  const sessionType = parseOptionalSessionType(body.sessionType);
  const track = parseOptionalTrack(body.track);
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
  if (!track) {
    return NextResponse.json({ error: "Invalid track" }, { status: 400 });
  }

  const session = await atomicCreateSessionWithProgression({
    userId: auth.user.userId,
    sessionType,
    completed,
    track,
    session: {
      userId: auth.user.userId,
      dayNumber,
      sessionType,
      track,
      duration,
      bonusSeconds,
      completed,
      actualTime: actualTime ?? duration,
      clearPercent,
      thoughtCount: thoughtCount ?? 0,
      breathCount,
      mindStateLog: mindStateLog ?? [],
      sessionDate,
    },
  });

  return NextResponse.json({ session });
});
