import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { RouteParams, withApiHandler } from "@/lib/api/withApiHandler";
import { reconcileBuddySession } from "@/lib/buddySession";
import {
  BUDDY_POLICY_CODES,
  buddyPolicyJson,
  requireBuddyHost,
  requireLobbyForCancel,
} from "@/lib/buddySessionControlsPolicy";
import { isUuid } from "@/lib/friends";
import { and, eq, inArray, sql } from "drizzle-orm";

type RouteContext = RouteParams<{ id: string }>;

export const POST = withApiHandler(
  "Buddy cancel",
  async (_request: NextRequest, context: RouteContext) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

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
          eq(buddySessionParticipants.userId, auth.user.userId),
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
  },
);