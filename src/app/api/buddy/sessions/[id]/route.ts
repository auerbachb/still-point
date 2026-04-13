import { NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessionParticipants } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  buildBuddySnapshot,
  loadBuddySnapshotContext,
  reconcileBuddySession,
} from "@/lib/buddySession";
import { BUDDY_POLICY_CODES } from "@/lib/buddyPolicyCodes";
import { isUuid } from "@/lib/friends";
import { and, eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Params) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
          eq(buddySessionParticipants.userId, auth.userId),
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
      snapshot: buildBuddySnapshot(ctx.session, ctx.participants, auth.userId),
    });
  } catch (error) {
    console.error("Buddy session GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
