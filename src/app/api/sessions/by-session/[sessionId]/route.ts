import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, thoughts } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { RouteParams, withApiHandler } from "@/lib/api/withApiHandler";
import { isUuid } from "@/lib/friends";
import { MOOD_KEYS } from "@/lib/moodMatrix";
import { eq, and, asc, sql, type SQL } from "drizzle-orm";

type RouteContext = RouteParams<{ sessionId: string }>;

const RATING_FIELDS = ["focusRating", "happinessRating"] as const;

function isValidRating(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
}

/** Mood matrix cells use a 1–5 scale (compact 5-box tap UI). */
function isValidMoodValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

type MoodRow = { before: number | null; after: number | null };

/** Both cells are required keys; either may be null. A row with both null is
 *  valid and means "delete this row" (#792). */
function isValidMoodEntry(entry: unknown): entry is MoodRow {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
  const e = entry as Record<string, unknown>;
  const beforeOk = e.before === null || isValidMoodValue(e.before);
  const afterOk = e.after === null || isValidMoodValue(e.after);
  return beforeOk && afterOk;
}

/** Validate a moodMatrix payload. `null` clears the stored matrix (#792); `{}`
 *  stays an error so that an empty body can never delete data. */
function validateMoodMatrix(
  value: unknown,
): { validated: Record<string, MoodRow> | null } | { error: string } {
  if (value === null) {
    return { validated: null };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "moodMatrix must be a JSON object or null" };
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return { error: "moodMatrix must have at least one mood entry" };
  }
  const validated: Record<string, MoodRow> = {};
  for (const key of keys) {
    if (!(MOOD_KEYS as readonly string[]).includes(key)) {
      return { error: `Unknown mood key: ${key}` };
    }
    if (!isValidMoodEntry(obj[key])) {
      return {
        error: `Invalid mood entry for ${key}: each entry must have before/after (1-5 or null)`,
      };
    }
    validated[key] = obj[key] as MoodRow;
  }
  return { validated };
}

/** Merge submitted rows into the stored matrix. An all-null row removes that
 *  row, and a matrix left with no rows is stored as null — the same value GET
 *  returns for a session with no mood recorded.
 *
 *  #834: the merge is SQL over the column, so the UPDATE that writes the matrix
 *  is also the one that reads it. Merged from an earlier SELECT, two PATCHes
 *  that overlapped both started from the same stored rows, and the later write
 *  dropped the other's rows or brought back one it had deleted. Each part is one
 *  JSON parameter, so no driver has to encode an array. */
function mergeMoodMatrixSql(submitted: Record<string, MoodRow>): SQL {
  const setRows: Record<string, MoodRow> = {};
  const deletedKeys: string[] = [];
  for (const [key, row] of Object.entries(submitted)) {
    if (row.before === null && row.after === null) {
      deletedKeys.push(key);
    } else {
      setRows[key] = row;
    }
  }
  return sql`NULLIF(
    (COALESCE(${sessions.moodMatrix}, '{}'::jsonb)
      - ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(deletedKeys)}::jsonb)))
      || ${JSON.stringify(setRows)}::jsonb,
    '{}'::jsonb
  )`;
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
        moodMatrix: SQL | null;
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

    // #472: mood matrix — validate incoming rows and merge with persisted data.
    // #792: `null` clears it. #834: the merge runs inside the update below, which
    // scopes to the owner, so a mood write against another user's session (or
    // one that no longer exists) is a 404 like any other write.
    if (bodyObj.moodMatrix !== undefined) {
      const result = validateMoodMatrix(bodyObj.moodMatrix);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      updates.moodMatrix = result.validated === null ? null : mergeMoodMatrixSql(result.validated);
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
