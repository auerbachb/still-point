import { NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { reconcileBuddySession } from "@/lib/buddySession";
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

    if (!p?.isHost || p.leftAt != null) {
      return NextResponse.json({ error: "Only the host can cancel" }, { status: 403 });
    }

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
      return NextResponse.json(
        { error: "Session cannot be cancelled now" },
        { status: 409 },
      );
    }

    await reconcileBuddySession(sessionId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Buddy cancel error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
