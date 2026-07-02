import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { failureReasons } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { readJsonObject } from "@/lib/readJsonObject";
import { addDaysToIsoDate, isValidSessionCalendarDate } from "@/lib/sessionCalendar";

const MAX_REASON_LENGTH = 1000;

const failureReasonsLogError = (label: string, error: unknown) => {
  console.error(`${label} error:`, error instanceof Error ? error.message : "unknown error");
};

/**
 * Latest date a reason may be logged for. The server doesn't know the caller's
 * timezone, so allow UTC-today + 1 day to cover users ahead of UTC. This blocks
 * pre-logging genuinely future days, which would otherwise make the scheduler
 * treat them as "already logged" and suppress the reminder (#441 review).
 */
function maxReasonDate(): string {
  return addDaysToIsoDate(new Date().toISOString().slice(0, 10), 1);
}

function serializeFailureReason(row: typeof failureReasons.$inferSelect) {
  return {
    id: row.id,
    reasonDate: row.reasonDate,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const GET = withApiHandler(
  "Failure reasons GET",
  async (request: NextRequest) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const date = new URL(request.url).searchParams.get("date");
    if (!date || !isValidSessionCalendarDate(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }

    const [row] = await db
      .select()
      .from(failureReasons)
      .where(and(eq(failureReasons.userId, auth.user.userId), eq(failureReasons.reasonDate, date)))
      .limit(1);

    return NextResponse.json({
      exists: !!row,
      failureReason: row ? serializeFailureReason(row) : null,
    });
  },
  { logError: failureReasonsLogError },
);

export const POST = withApiHandler(
  "Failure reasons POST",
  async (request: NextRequest) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const json = await readJsonObject(request);
    if (!json.ok) {
      return json.response;
    }

    const { reasonDate, text } = json.body;

    if (typeof reasonDate !== "string" || !isValidSessionCalendarDate(reasonDate)) {
      return NextResponse.json({ error: "reasonDate must be YYYY-MM-DD" }, { status: 400 });
    }
    if (reasonDate > maxReasonDate()) {
      return NextResponse.json({ error: "reasonDate cannot be in the future" }, { status: 400 });
    }

    if (typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ error: "text must not be empty" }, { status: 400 });
    }
    if (trimmed.length > MAX_REASON_LENGTH) {
      return NextResponse.json(
        { error: `text must be at most ${MAX_REASON_LENGTH} characters` },
        { status: 400 },
      );
    }

    // Upsert so a user can revise an existing reason for the same day.
    const now = new Date();
    const [row] = await db
      .insert(failureReasons)
      .values({
        userId: auth.user.userId,
        reasonDate,
        text: trimmed,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [failureReasons.userId, failureReasons.reasonDate],
        set: { text: trimmed, updatedAt: now },
      })
      .returning();

    return NextResponse.json({ failureReason: serializeFailureReason(row) });
  },
  { logError: failureReasonsLogError },
);
