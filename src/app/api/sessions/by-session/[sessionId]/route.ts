import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, thoughts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isUuid } from "@/lib/friends";
import { eq, and, asc } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;
    if (!sessionId || !isUuid(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const [session] = await db.select()
      .from(sessions)
      .where(and(
        eq(sessions.userId, auth.userId),
        eq(sessions.id, sessionId),
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
          eq(thoughts.userId, auth.userId),
        ),
      )
      .orderBy(
        asc(thoughts.timeInSession),
        asc(thoughts.createdAt),
        asc(thoughts.id),
      );

    return NextResponse.json({ session, thoughts: sessionThoughts });
  } catch (error) {
    console.error("Get session by id error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
