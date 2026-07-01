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

const RATING_FIELDS = ["focusRating", "happinessRating"] as const;

function isValidRating(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
}

/** #109: post-hoc CompletionScreen ratings update, matching the existing
 *  pattern of adding data to a session after it was created (see
 *  POST /api/thoughts/batch for the completion-note equivalent). */
export async function PATCH(
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

    const body = await request.json();
    const updates: Partial<Record<(typeof RATING_FIELDS)[number], number>> = {};

    for (const field of RATING_FIELDS) {
      if (body[field] === undefined) continue;
      if (!isValidRating(body[field])) {
        return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
      }
      updates[field] = body[field];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No supported ratings provided" }, { status: 400 });
    }

    const [updated] = await db
      .update(sessions)
      .set(updates)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ session: updated });
  } catch (error) {
    console.error("Update session ratings error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
