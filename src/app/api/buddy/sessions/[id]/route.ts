import { NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessionParticipants } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import {
  buildBuddySnapshot,
  loadBuddySnapshotContext,
  reconcileBuddySession,
} from "@/lib/buddySession";
import { BUDDY_POLICY_CODES } from "@/lib/buddyPolicyCodes";
import { isUuid } from "@/lib/friends";
import { and, eq } from "drizzle-orm";

export const GET = withApiHandler(
  "Buddy session GET",
  async (_request, context) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { id: sessionId } = await (context as { params: Promise<{ id: string }> }).params;
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

    await db
      .update(buddySessionParticipants)
      .set({ lastSeenAt: new Date() })
      .where(eq(buddySessionParticipants.id, membership.id));

    await reconcileBuddySession(sessionId);

    const ctx = await loadBuddySnapshotContext(sessionId);
    if (!ctx) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      snapshot: buildBuddySnapshot(ctx.session, ctx.participants, auth.user.userId),
    });
  },
);
