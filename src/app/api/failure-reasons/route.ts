import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { failureReasons } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { readJsonObject } from "@/lib/readJsonObject";
import { isValidSessionCalendarDate } from "@/lib/sessionCalendar";

const MAX_REASON_LENGTH = 1000;

function serializeFailureReason(row: typeof failureReasons.$inferSelect) {
  return {
    id: row.id,
    reasonDate: row.reasonDate,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const date = new URL(request.url).searchParams.get("date");
    if (!date || !isValidSessionCalendarDate(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }

    const [row] = await db
      .select()
      .from(failureReasons)
      .where(and(eq(failureReasons.userId, auth.userId), eq(failureReasons.reasonDate, date)))
      .limit(1);

    return NextResponse.json({
      exists: !!row,
      failureReason: row ? serializeFailureReason(row) : null,
    });
  } catch (error) {
    console.error("Failure reasons GET error:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const json = await readJsonObject(request);
    if (!json.ok) {
      return json.response;
    }

    const { reasonDate, text } = json.body;

    if (typeof reasonDate !== "string" || !isValidSessionCalendarDate(reasonDate)) {
      return NextResponse.json({ error: "reasonDate must be YYYY-MM-DD" }, { status: 400 });
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
        userId: auth.userId,
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
  } catch (error) {
    // Log only the error message, never the raw error — a DB driver error's `detail`/
    // `parameters` fields can echo the user's submitted reason text into server logs.
    console.error("Failure reasons POST error:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
