import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { atomicCreateSessionWithProgression } from "@/db/atomic";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { calculateSessionStats, parseCompleted, parseOptionalSessionType, parseOptionalTrack } from "@/lib/constants";
import { calculateHistoryPeriodStats } from "@/lib/historyStats";
import { calculateMindStateTrendStats } from "@/lib/historyMindStateTrends";
import { isValidSessionCalendarDate, todayLocalIsoDate } from "@/lib/sessionCalendar";
import { eq, desc } from "drizzle-orm";
import { sessions } from "@/db/schema";
import { isUuid } from "@/lib/friends";

export const GET = withApiHandler("Get sessions", async (request: NextRequest) => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  // Explicit column projection matching SessionDTO (mirrors the board/thoughts routes).
  // Never leak userId, clientSessionId, or the focus/happiness ratings the history list
  // does not consume (#612).
  const userSessions = await db.select({
    id: sessions.id,
    dayNumber: sessions.dayNumber,
    sessionType: sessions.sessionType,
    duration: sessions.duration,
    bonusSeconds: sessions.bonusSeconds,
    completed: sessions.completed,
    actualTime: sessions.actualTime,
    clearPercent: sessions.clearPercent,
    thoughtCount: sessions.thoughtCount,
    mindStateLog: sessions.mindStateLog,
    attentionLog: sessions.attentionLog,
    sessionDate: sessions.sessionDate,
    createdAt: sessions.createdAt,
    buddySessionId: sessions.buddySessionId,
    breathCount: sessions.breathCount,
    track: sessions.track,
    ambientSoundSummary: sessions.ambientSoundSummary,
  })
    .from(sessions)
    .where(eq(sessions.userId, auth.user.userId))
    .orderBy(desc(sessions.dayNumber));
  const stats = calculateSessionStats(userSessions);

  const todayParam = request.nextUrl.searchParams.get("today")?.trim();
  const todayIso = todayParam && isValidSessionCalendarDate(todayParam)
    ? todayParam
    : todayLocalIsoDate();
  const periodStats = calculateHistoryPeriodStats(userSessions, todayIso);
  const mindStateTrends = calculateMindStateTrendStats(userSessions, todayIso);

  return NextResponse.json({
    sessions: userSessions,
    stats: {
      ...stats,
      bonusMinutesTotal: Math.round(stats.bonusSecondsTotal / 60),
      ...periodStats,
      mindStateTrends,
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
  const { dayNumber, duration, actualTime, clearPercent, thoughtCount, mindStateLog, attentionLog, sessionDate } = body;
  // #563: ambient sound summary — validate shape and physical invariants; coerce
  // invalid/absent summaries to null rather than rejecting the whole session.
  const ambientRaw = body.ambientSoundSummary;
  const ambientSoundSummary =
    ambientRaw !== null &&
    typeof ambientRaw === "object" &&
    !Array.isArray(ambientRaw) &&
    typeof ambientRaw.avgDb === "number" && Number.isFinite(ambientRaw.avgDb) &&
    typeof ambientRaw.peakDb === "number" && Number.isFinite(ambientRaw.peakDb) &&
    ambientRaw.peakDb >= ambientRaw.avgDb &&           // peak must be ≥ average (dBFS)
    typeof ambientRaw.quietPercent === "number" && Number.isInteger(ambientRaw.quietPercent) &&
    ambientRaw.quietPercent >= 0 && ambientRaw.quietPercent <= 100 &&
    typeof ambientRaw.loudPercent === "number" && Number.isInteger(ambientRaw.loudPercent) &&
    ambientRaw.loudPercent >= 0 && ambientRaw.loudPercent <= 100 &&
    ambientRaw.quietPercent + ambientRaw.loudPercent === 100 && // every sample is classified
    typeof ambientRaw.sampleCount === "number" && Number.isInteger(ambientRaw.sampleCount) &&
    ambientRaw.sampleCount > 0
      ? {
          avgDb: ambientRaw.avgDb as number,
          peakDb: ambientRaw.peakDb as number,
          quietPercent: ambientRaw.quietPercent as number,
          loudPercent: ambientRaw.loudPercent as number,
          sampleCount: ambientRaw.sampleCount as number,
        }
      : null;
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

  const clientSessionIdRaw = body.clientSessionId;
  let clientSessionId: string | null = null;
  if (clientSessionIdRaw != null) {
    if (typeof clientSessionIdRaw !== "string" || !isUuid(clientSessionIdRaw)) {
      return NextResponse.json({ error: "Invalid clientSessionId" }, { status: 400 });
    }
    clientSessionId = clientSessionIdRaw;
  }

  const { session, already } = await atomicCreateSessionWithProgression({
    userId: auth.user.userId,
    sessionType,
    completed,
    track,
    session: {
      userId: auth.user.userId,
      clientSessionId,
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
      attentionLog: Array.isArray(attentionLog) ? attentionLog : null,
      ambientSoundSummary,
      sessionDate,
    },
  });

  return NextResponse.json(already ? { session, already: true } : { session });
});
