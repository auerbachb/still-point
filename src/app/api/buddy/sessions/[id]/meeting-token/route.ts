import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants, users } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { RouteParams, withApiHandler } from "@/lib/api/withApiHandler";
import { reconcileBuddySession } from "@/lib/buddySession";
import { BUDDY_POLICY_CODES } from "@/lib/buddyPolicyCodes";
import { DailyApiError, createMeetingToken } from "@/lib/daily";
import { isUuid } from "@/lib/friends";
import { and, eq } from "drizzle-orm";

type RouteContext = RouteParams<{ id: string }>;

export const POST = withApiHandler(
  "Buddy meeting-token route",
  async (_request: NextRequest, context: RouteContext) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { id: sessionId } = await context.params;
    if (!isUuid(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const [membership] = await db
      .select()
      .from(buddySessionParticipants)
      .where(
        and(
          eq(buddySessionParticipants.buddySessionId, sessionId),
          eq(buddySessionParticipants.userId, auth.user.userId),
        ),
      )
      .limit(1);

    if (!membership || membership.leftAt != null) {
      return NextResponse.json(
        { error: "Not in this session", code: BUDDY_POLICY_CODES.NOT_IN_SESSION },
        { status: 403 },
      );
    }

    await reconcileBuddySession(sessionId);

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, sessionId))
      .limit(1);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.state !== "active" || !session.dailyRoomName?.trim()) {
      return NextResponse.json(
        { error: "Video token is only available during an active buddy sit" },
        { status: 403 },
      );
    }

    const [u] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, auth.user.userId))
      .limit(1);

    try {
      const token = await createMeetingToken({
        roomName: session.dailyRoomName,
        userName: u?.username ?? "Participant",
        userId: auth.user.userId,
      });
      return NextResponse.json({ token });
    } catch (e) {
      if (e instanceof DailyApiError) {
        console.error("Buddy meeting token error:", e.status, e.message);
        return NextResponse.json(
          { error: "Could not issue a video token. Check Daily configuration." },
          { status: 503 },
        );
      }
      throw e;
    }
  },
);