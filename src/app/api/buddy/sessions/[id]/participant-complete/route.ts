import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { RouteParams, withApiHandler } from "@/lib/api/withApiHandler";
import { bumpBuddyRevision } from "@/lib/buddySession";
import {
  requireBuddyActiveParticipant,
  requireParticipantCompletePhase,
} from "@/lib/buddySessionControlsPolicy";
import { isUuid } from "@/lib/friends";
import { and, eq, isNull } from "drizzle-orm";

type RouteContext = RouteParams<{ id: string }>;

/**
 * #119: Marks this participant as finished with the shared sit (no journaling here).
 * #118: Per-user only; does not mutate shared timer — see `buddySessionControlsPolicy.ts`.
 */
export const POST = withApiHandler(
  "Buddy participant-complete",
  async (_request: NextRequest, context: RouteContext) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { id: sessionId } = await context.params;
    if (!isUuid(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, sessionId))
      .limit(1);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const phaseErr = requireParticipantCompletePhase(session.state);
    if (phaseErr) return phaseErr;

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

    const memberErr = requireBuddyActiveParticipant(p);
    if (memberErr) return memberErr;

    if (p.participantCompletedAt != null) {
      return NextResponse.json({ ok: true, already: true });
    }

    const now = new Date();
    const [done] = await db
      .update(buddySessionParticipants)
      .set({ participantCompletedAt: now, lastSeenAt: now })
      .where(
        and(
          eq(buddySessionParticipants.id, p.id),
          isNull(buddySessionParticipants.participantCompletedAt),
        ),
      )
      .returning();

    if (!done) {
      return NextResponse.json({ ok: true, already: true });
    }

    await bumpBuddyRevision(sessionId);

    return NextResponse.json({ ok: true, participantCompletedAt: now.toISOString() });
  },
);