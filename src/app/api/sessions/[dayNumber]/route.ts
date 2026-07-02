import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, thoughts } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { eq, and, asc } from "drizzle-orm";

export const GET = withApiHandler(
  "Get session",
  async (_request: NextRequest, context) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { dayNumber } = await (context as { params: Promise<{ dayNumber: string }> }).params;
    const dayNum = parseInt(dayNumber, 10);
    if (isNaN(dayNum)) {
      return NextResponse.json({ error: "Invalid day number" }, { status: 400 });
    }

    const [session] = await db.select()
      .from(sessions)
      .where(and(
        eq(sessions.userId, auth.user.userId),
        eq(sessions.dayNumber, dayNum),
      ))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sessionThoughts = await db.select({
      id: thoughts.id,
      sessionId: thoughts.sessionId,
      dayNumber: thoughts.dayNumber,
      timeInSession: thoughts.timeInSession,
      text: thoughts.text,
    })
      .from(thoughts)
      .where(
        and(
          eq(thoughts.sessionId, session.id),
          eq(thoughts.userId, auth.user.userId),
        ),
      )
      .orderBy(
        asc(thoughts.timeInSession),
        asc(thoughts.createdAt),
        asc(thoughts.id),
      );

    return NextResponse.json({ session, thoughts: sessionThoughts });
  },
);
