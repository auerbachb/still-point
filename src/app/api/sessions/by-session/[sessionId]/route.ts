import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, thoughts } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { isUuid } from "@/lib/friends";
import { eq, and, asc } from "drizzle-orm";

const RATING_FIELDS = ["focusRating", "happinessRating"] as const;

function isValidRating(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
}

export const GET = withApiHandler(
  "Get session by id",
  async (_request: NextRequest, context) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { sessionId } = await (context as { params: Promise<{ sessionId: string }> }).params;
    if (!sessionId || !isUuid(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const [session] = await db.select()
      .from(sessions)
      .where(and(
        eq(sessions.userId, auth.user.userId),
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

/** #109: post-hoc CompletionScreen ratings update, matching the existing
 *  pattern of adding data to a session after it was created (see
 *  POST /api/thoughts/batch for the completion-note equivalent). */
export const PATCH = withApiHandler(
  "Update session ratings",
  async (request: NextRequest, context) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { sessionId } = await (context as { params: Promise<{ sessionId: string }> }).params;
    if (!sessionId || !isUuid(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }
    const updates: Partial<Record<(typeof RATING_FIELDS)[number], number>> = {};
    const bodyObj = body as Record<string, unknown>;

    for (const field of RATING_FIELDS) {
      if (bodyObj[field] === undefined) continue;
      if (!isValidRating(bodyObj[field])) {
        return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
      }
      updates[field] = bodyObj[field] as number;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No supported ratings provided" }, { status: 400 });
    }

    const [updated] = await db
      .update(sessions)
      .set(updates)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.user.userId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ session: updated });
  },
);
