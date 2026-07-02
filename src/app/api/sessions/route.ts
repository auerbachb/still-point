import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { poolDb } from "@/db/pool";
import { sessions, users } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { calculateSessionStats, parseCompleted, parseOptionalSessionType, parseOptionalTrack, shouldAdvanceDay } from "@/lib/constants";
import { advanceProgression, advanceSecondTrackDay } from "@/lib/duration";
import { eq, desc } from "drizzle-orm";

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

  const body = await request.json();
  const { dayNumber, duration, actualTime, clearPercent, thoughtCount, mindStateLog, sessionDate } = body;
  const completed = parseCompleted(body.completed);
  const sessionType = parseOptionalSessionType(body.sessionType);
  // #240: which daily track this sit belongs to. Absent/legacy payloads → primary.
  const track = parseOptionalTrack(body.track);
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
  if (!track) {
    return NextResponse.json({ error: "Invalid track" }, { status: 400 });
  }

  // Quick sessions are extra practice and do not advance the daily progression.
  // Wrap the insert + any progression update in a single transaction and lock the
  // user row for update so concurrent standard-session completions can't clobber
  // each other's advancement (#238 race condition).
  const session = await poolDb.transaction(async (tx) => {
    const [created] = await tx.insert(sessions).values({
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
    }).returning();

    if (shouldAdvanceDay(sessionType, completed)) {
      // Read the user's current progression inside the transaction so the
      // insert + update are atomic. Concurrent completions now serialize
      // at the transaction boundary rather than racing on a shared snapshot.
      const [current] = await tx
        .select({
          currentDay: users.currentDay,
          recoveryTargetDay: users.recoveryTargetDay,
          recoveryCurrentStep: users.recoveryCurrentStep,
          recoveryTotalSteps: users.recoveryTotalSteps,
          dualTrackEnabled: users.dualTrackEnabled,
          secondTrackDay: users.secondTrackDay,
        })
        .from(users)
        .where(eq(users.id, auth.user.userId))
        .limit(1);

      if (current) {
        if (track === "second") {
          // #240: the second track advances its own counter, and only when the
          // user has actually opted into dual-track. It has no recovery ramp and
          // never touches `currentDay` (the primary track), so the two progress
          // independently. A `second` payload from a non-dual user is ignored
          // defensively rather than trusted.
          if (current.dualTrackEnabled) {
            await tx.update(users)
              .set({
                secondTrackDay: advanceSecondTrackDay(sessionType, completed, current.secondTrackDay),
                updatedAt: new Date(),
              })
              .where(eq(users.id, auth.user.userId));
          }
        } else {
          // #238: while recovering, a completed primary sit steps the ramp forward
          // instead of bumping `currentDay` — see advanceProgression for the full rule.
          const next = advanceProgression(sessionType, completed, current);
          await tx.update(users)
            .set({
              currentDay: next.currentDay,
              recoveryTargetDay: next.recoveryTargetDay,
              recoveryCurrentStep: next.recoveryCurrentStep,
              recoveryTotalSteps: next.recoveryTotalSteps,
              updatedAt: new Date(),
            })
            .where(eq(users.id, auth.user.userId));
        }
      }
    }

    return created;
  });

  return NextResponse.json({ session });
});
