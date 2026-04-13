import { NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { reconcileBuddySession } from "@/lib/buddySession";
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

    if (!p?.isHost || p.leftAt != null) {
      return NextResponse.json({ error: "Only the host can start" }, { status: 403 });
    }

    await reconcileBuddySession(sessionId);

    const startedAt = new Date();
    const [updated] = await db
      .update(buddySessions)
      .set({
        state: "active",
        startedAt,
        revision: sql`${buddySessions.revision} + 1`,
        updatedAt: startedAt,
      })
      .where(
        and(eq(buddySessions.id, sessionId), eq(buddySessions.state, "ready_check")),
      )
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Everyone must be ready and at least one guest must join before starting" },
        { status: 409 },
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
