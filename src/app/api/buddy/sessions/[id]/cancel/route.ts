import { NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { reconcileBuddySession } from "@/lib/buddySession";
import {
  BUDDY_POLICY_CODES,
  buddyPolicyJson,
  requireBuddyHost,
  requireLobbyForCancel,
} from "@/lib/buddySessionControlsPolicy";
import { isUuid } from "@/lib/friends";
import { and, eq, inArray, sql } from "drizzle-orm";

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

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, sessionId))
      .limit(1);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const phaseErr = requireLobbyForCancel(session);
    if (phaseErr) return phaseErr;

    const [updated] = await db
      .update(buddySessions)
      .set({
        state: "abandoned",
        revision: sql`${buddySessions.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(buddySessions.id, sessionId),
          inArray(buddySessions.state, ["waiting", "ready_check"]),
        ),
      )
      .returning();

    if (!updated) {
      return buddyPolicyJson(
        409,
        "Session cannot be cancelled now",
        BUDDY_POLICY_CODES.CANCEL_WRONG_PHASE,
      );
    }

    await reconcileBuddySession(sessionId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Buddy cancel error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
