import { NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { reconcileBuddySession } from "@/lib/buddySession";
import { DailyApiError, createRoom, deleteRoom } from "@/lib/daily";
import { BUDDY_START_WRONG_PHASE_MESSAGE } from "@/lib/buddyPolicyCodes";
import {
  BUDDY_POLICY_CODES,
  buddyPolicyJson,
  requireBuddyHost,
  requireReadyCheckForStart,
} from "@/lib/buddySessionControlsPolicy";
import { isUuid } from "@/lib/friends";
import { and, eq, sql } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Params) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: sessionId } = await context.params;
    if (!isUuid(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const [p] = await db
      .select()
      .from(buddySessionParticipants)
      .where(
        and(
          eq(buddySessionParticipants.buddySessionId, sessionId),
          eq(buddySessionParticipants.userId, auth.userId),
        ),
      )
      .limit(1);

    const hostErr = requireBuddyHost(p);
    if (hostErr) return hostErr;

    await reconcileBuddySession(sessionId);

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, sessionId))
      .limit(1);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const phaseErr = requireReadyCheckForStart(session);
    if (phaseErr) return phaseErr;

    const roomName = `buddy-${sessionId}`;
    let dailyRoom: { name: string; url: string };
    try {
      dailyRoom = await createRoom({ name: roomName, privacy: "private" });
    } catch (e) {
      if (e instanceof DailyApiError) {
        return NextResponse.json(
          { error: "Video room could not be created. Check Daily configuration and try again." },
          { status: 503 },
        );
      }
      throw e;
    }

    const startedAt = new Date();
    const [updated] = await db
      .update(buddySessions)
      .set({
        state: "active",
        startedAt,
        dailyRoomName: dailyRoom.name,
        dailyRoomUrl: dailyRoom.url,
        revision: sql`${buddySessions.revision} + 1`,
        updatedAt: startedAt,
      })
      .where(
        and(eq(buddySessions.id, sessionId), eq(buddySessions.state, "ready_check")),
      )
      .returning();

    if (!updated) {
      try {
        await deleteRoom(dailyRoom.name, { ignoreMissing: true });
      } catch (cleanupErr) {
        console.error("Buddy start race: Daily room cleanup failed:", cleanupErr);
      }
      return buddyPolicyJson(
        409,
        BUDDY_START_WRONG_PHASE_MESSAGE,
        BUDDY_POLICY_CODES.START_WRONG_PHASE,
      );
    }

    await db
      .update(buddySessionParticipants)
      .set({ lastSeenAt: startedAt })
      .where(eq(buddySessionParticipants.buddySessionId, sessionId));

    return NextResponse.json({ ok: true, startedAt: startedAt.toISOString() });
  } catch (error) {
    console.error("Buddy start error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
