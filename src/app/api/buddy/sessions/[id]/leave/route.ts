import { NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import {
  bumpBuddyRevision,
  reconcileBuddySession,
  syncBuddySessionDurationForParticipants,
  teardownBuddyDailyRoomByName,
} from "@/lib/buddySession";
import { hostLeaveShouldAbandonSession } from "@/lib/buddySessionControlsPolicy";
import { isUuid } from "@/lib/friends";
import { and, eq, sql } from "drizzle-orm";

export const POST = withApiHandler(
  "Buddy leave",
  async (_request, context) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { id: sessionId } = await (context as { params: Promise<{ id: string }> }).params;
    if (!isUuid(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const [p] = await db
      .select()
      .from(buddySessionParticipants)
      .where(
        and(
          eq(buddySessionParticipants.buddySessionId, sessionId),
          eq(buddySessionParticipants.userId, auth.user.userId),
        ),
      )
      .limit(1);

    if (!p || p.leftAt != null) {
      return NextResponse.json({ ok: true });
    }

    const now = new Date();
    await db
      .update(buddySessionParticipants)
      .set({ leftAt: now, lastSeenAt: now, ready: false })
      .where(eq(buddySessionParticipants.id, p.id));

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, sessionId))
      .limit(1);

    if (p.isHost && session && hostLeaveShouldAbandonSession(session)) {
      await teardownBuddyDailyRoomByName(session.dailyRoomName);
      await db
        .update(buddySessions)
        .set({
          state: "abandoned",
          dailyRoomName: null,
          dailyRoomUrl: null,
          revision: sql`${buddySessions.revision} + 1`,
          updatedAt: now,
        })
        .where(eq(buddySessions.id, sessionId));
    } else {
      await syncBuddySessionDurationForParticipants(sessionId);
      await bumpBuddyRevision(sessionId);
    }

    await reconcileBuddySession(sessionId);

    return NextResponse.json({ ok: true });
  },
);
