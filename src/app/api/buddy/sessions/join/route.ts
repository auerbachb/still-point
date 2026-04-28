import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  assertBuddyFriendshipIfRequired,
  bumpBuddyRevision,
  reconcileBuddySession,
} from "@/lib/buddySession";
import {
  GOOGLE_CALENDAR_SYNC_FAILED_MESSAGE,
  syncBuddySessionCalendarForUser,
} from "@/lib/google";
import { and, eq } from "drizzle-orm";
import { readJsonObject } from "@/lib/readJsonObject";
import type { CalendarSyncResult } from "@/lib/google";

async function syncCalendarBestEffort(
  session: typeof buddySessions.$inferSelect,
  userId: string,
): Promise<CalendarSyncResult[]> {
  if (!session.scheduledStartAt) return [];
  try {
    return [await syncBuddySessionCalendarForUser(session, userId)];
  } catch (error) {
    console.error("Buddy join Google Calendar sync error:", error);
    return [
      {
        status: "failed" as const,
        userId,
        error: GOOGLE_CALENDAR_SYNC_FAILED_MESSAGE,
      },
    ];
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const json = await readJsonObject(request);
    if (!json.ok) return json.response;

    const token = json.body.token;
    if (typeof token !== "string" || !token.trim()) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }
    const trimmed = token.trim();

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.shareToken, trimmed))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.state === "abandoned" || session.state === "completed") {
      return NextResponse.json(
        { error: "This session is no longer available" },
        { status: 409 },
      );
    }

    try {
      await assertBuddyFriendshipIfRequired(session.hostUserId, auth.userId);
    } catch (e) {
      if ((e as Error & { code?: string }).code === "NOT_FRIENDS") {
        return NextResponse.json(
          { error: "You must be friends with the host to join" },
          { status: 403 },
        );
      }
      throw e;
    }

    const [existing] = await db
      .select()
      .from(buddySessionParticipants)
      .where(
        and(
          eq(buddySessionParticipants.buddySessionId, session.id),
          eq(buddySessionParticipants.userId, auth.userId),
        ),
      )
      .limit(1);

    if (session.state === "active") {
      if (!existing) {
        return NextResponse.json(
          { error: "Session already started; new guests cannot join" },
          { status: 409 },
        );
      }
      await db
        .update(buddySessionParticipants)
        .set({ leftAt: null, lastSeenAt: new Date() })
        .where(eq(buddySessionParticipants.id, existing.id));
      await bumpBuddyRevision(session.id);
      await reconcileBuddySession(session.id);
      const calendarSync = await syncCalendarBestEffort(session, auth.userId);
      return NextResponse.json({
        sessionId: session.id,
        scheduledStartAt: session.scheduledStartAt?.toISOString() ?? null,
        calendarSync,
      });
    }

    if (session.state === "waiting" || session.state === "ready_check") {
      const now = new Date();
      if (existing) {
        await db
          .update(buddySessionParticipants)
          .set({
            leftAt: null,
            lastSeenAt: now,
            ready: existing.leftAt != null ? false : existing.ready,
          })
          .where(eq(buddySessionParticipants.id, existing.id));
      } else {
        await db.insert(buddySessionParticipants).values({
          buddySessionId: session.id,
          userId: auth.userId,
          isHost: false,
          ready: false,
          lastSeenAt: now,
        });
      }
      await bumpBuddyRevision(session.id);
      await reconcileBuddySession(session.id);
      const calendarSync = await syncCalendarBestEffort(session, auth.userId);
      return NextResponse.json({
        sessionId: session.id,
        scheduledStartAt: session.scheduledStartAt?.toISOString() ?? null,
        calendarSync,
      });
    }

    return NextResponse.json({ error: "Cannot join this session" }, { status: 409 });
  } catch (error) {
    console.error("Buddy join error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
