import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, thoughts } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { RouteParams, withApiHandler } from "@/lib/api/withApiHandler";
import { isUuid } from "@/lib/friends";
import { MOOD_KEYS } from "@/lib/moodMatrix";
import { eq, and, asc } from "drizzle-orm";

type RouteContext = RouteParams<{ sessionId: string }>;

const RATING_FIELDS = ["focusRating", "happinessRating"] as const;

function isValidRating(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
}

/** Mood matrix cells use a 1–5 scale (compact 5-box tap UI). */
function isValidMoodValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

function isValidMoodEntry(entry: unknown): entry is { before: number | null; after: number | null } {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
  const e = entry as Record<string, unknown>;
  const beforeOk = e.before === null || isValidMoodValue(e.before);
  const afterOk = e.after === null || isValidMoodValue(e.after);
  return beforeOk && afterOk && (e.before !== null || e.after !== null);
}

/** Validate a full moodMatrix payload object. Returns an error string or null. */
function validateMoodMatrix(
  value: unknown,
): { validated: Record<string, { before: number | null; after: number | null }> } | { error: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "moodMatrix must be a JSON object" };
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return { error: "moodMatrix must have at least one mood entry" };
  }
  const validated: Record<string, { before: number | null; after: number | null }> = {};
  for (const key of keys) {
    if (!(MOOD_KEYS as readonly string[]).includes(key)) {
      return { error: `Unknown mood key: ${key}` };
    }
    if (!isValidMoodEntry(obj[key])) {
      return {
        error: `Invalid mood entry for ${key}: each entry must have before/after (1-5 or null, at least one non-null)`,
      };
    }
    validated[key] = obj[key] as { before: number | null; after: number | null };
  }
  return { validated };
}

export const GET = withApiHandler(
  "Get session by id",
  async (_request: NextRequest, context: RouteContext) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { sessionId } = await context.params;
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
  async (request: NextRequest, context: RouteContext) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { sessionId } = await context.params;
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
    const updates: Partial<
      Record<(typeof RATING_FIELDS)[number], number> & {
        moodMatrix: Record<string, { before: number | null; after: number | null }>;
      }
    > = {};
    const bodyObj = body as Record<string, unknown>;

    for (const field of RATING_FIELDS) {
      if (bodyObj[field] === undefined) continue;
      if (!isValidRating(bodyObj[field])) {
        return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
      }
      updates[field] = bodyObj[field] as number;
    }

    // #472: mood matrix — validate and merge with existing session data.
    if (bodyObj.moodMatrix !== undefined) {
      const result = validateMoodMatrix(bodyObj.moodMatrix);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      updates.moodMatrix = result.validated;
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
