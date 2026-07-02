import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { atomicReplaceCompletionNoteAndInsertThoughts } from "@/db/atomic";
import { sessions } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { isUuid } from "@/lib/friends";
import { readJsonObject } from "@/lib/readJsonObject";
import { hasRejectedSubmittedThoughts, normalizeThoughtInputs } from "@/lib/thoughtSaving";
import { and, eq } from "drizzle-orm";

export const POST = withApiHandler("Batch thoughts", async (request: NextRequest) => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const json = await readJsonObject(request);
  if (!json.ok) return json.response;
  const { sessionId, dayNumber, thoughts: thoughtItems } = json.body;

  if (
    typeof sessionId !== "string" ||
    !isUuid(sessionId) ||
    typeof dayNumber !== "number" ||
    !Number.isFinite(dayNumber) ||
    !Array.isArray(thoughtItems)
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (thoughtItems.length === 0) {
    return NextResponse.json({ thoughts: [] });
  }

  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.user.userId)))
    .limit(1);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.dayNumber !== dayNumber) {
    return NextResponse.json({ error: "Day number mismatch" }, { status: 400 });
  }

  const normalizedResult = normalizeThoughtInputs(thoughtItems);
  if (hasRejectedSubmittedThoughts(normalizedResult)) {
    console.warn("Batch thoughts rejected invalid payload", {
      sessionId,
      userId: auth.user.userId,
      submittedCount: normalizedResult.submittedCount,
      invalidCount: normalizedResult.invalidCount,
    });
    return NextResponse.json({ error: "Invalid thoughts payload" }, { status: 400 });
  }
  const normalized = normalizedResult.thoughts;
  const completionNoteCount = normalized.filter((t) => t.timeInSession === -1).length;
  if (completionNoteCount > 1) {
    console.warn("Batch thoughts rejected duplicate completion notes", {
      sessionId,
      userId: auth.user.userId,
      completionNoteCount,
    });
    return NextResponse.json({ error: "Invalid thoughts payload" }, { status: 400 });
  }

  const completionNote = normalized.filter((t) => t.timeInSession === -1).at(-1) ?? null;
  const rowsToInsert = [
    ...normalized.filter((t) => t.timeInSession !== -1),
    ...(completionNote ? [completionNote] : []),
  ];

  const inserted = await atomicReplaceCompletionNoteAndInsertThoughts({
    userId: auth.user.userId,
    sessionId,
    dayNumber,
    completionNote,
    rowsToInsert,
  });

  return NextResponse.json({ thoughts: inserted });
});
