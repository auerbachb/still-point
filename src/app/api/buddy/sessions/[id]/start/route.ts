import { NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { reconcileBuddySession } from "@/lib/buddySession";
import {
  DailyApiError,
  createRoom,
  deleteRoom,
  isDailyRoomNameConflict,
} from "@/lib/daily";
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
    if (session.scheduledStartAt && session.scheduledStartAt.getTime() > Date.now()) {
      return NextResponse.json(
        { error: "This session is scheduled for later." },
        { status: 409 },
      );
    }

    const roomName = `buddy-${sessionId}`;
    let dailyRoom: { name: string; url: string };
    try {
      dailyRoom = await createRoom({ name: roomName, privacy: "private" });
    } catch (e) {
      if (e instanceof DailyApiError && isDailyRoomNameConflict(e)) {
        await deleteRoom(roomName, { ignoreMissing: true });
        try {
          dailyRoom = await createRoom({ name: roomName, privacy: "private" });
        } catch (e2) {
          if (e2 instanceof DailyApiError) {
            return NextResponse.json(
              {
                error:
                  "Video room could not be created (name conflict after cleanup). Check Daily and try again.",
              },
              { status: 503 },
            );
          }
          console.error("Buddy start Daily retry error:", e2);
          return NextResponse.json(
            { error: "Video room could not be created. Check Daily configuration and try again." },
            { status: 503 },
          );
        }
      } else if (e instanceof DailyApiError) {
        return NextResponse.json(
          { error: "Video room could not be created. Check Daily configuration and try again." },
          { status: 503 },
        );
      } else if (e instanceof Error && e.message.includes("DAILY_API_KEY")) {
        console.error("Buddy start: Daily API key missing on server");
        return NextResponse.json(
          {
            error:
              "Video is not configured on this server (DAILY_API_KEY). Add it in Vercel env and redeploy.",
          },
          { status: 503 },
        );
      } else {
        console.error("Buddy start Daily unexpected error:", e);
        return NextResponse.json(
          { error: "Video room could not be created. Check Daily configuration and try again." },
          { status: 503 },
        );
      }
    }

    const startedAt = new Date();
    let updated: (typeof buddySessions.$inferSelect) | undefined;
    try {
      const rows = await db
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
      updated = rows[0];
    } catch (dbErr) {
      console.error("Buddy start DB update error:", dbErr);
      try {
        await deleteRoom(dailyRoom.name, { ignoreMissing: true });
      } catch (cleanupErr) {
        console.error("Buddy start: Daily room cleanup after DB failure:", cleanupErr);
      }
      const msg = dbErr instanceof Error ? dbErr.message : "";
      if (/daily_room|does not exist|42703/i.test(msg)) {
        return NextResponse.json(
          {
            error:
              "Database is missing buddy video columns. Run `npx drizzle-kit push` against production (see drizzle/buddy_sessions_daily_room_incremental.sql).",
          },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: "Could not start the shared session. Try again." }, { status: 503 });
    }

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
