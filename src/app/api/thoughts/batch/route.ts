import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { atomicReplaceCompletionNoteAndInsertThoughts } from "@/db/atomic";
import { sessions } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { isUuid } from "@/lib/friends";
import { readJsonObject } from "@/lib/readJsonObject";
import {
  hasRejectedSubmittedThoughts,
  normalizeThoughtInputs,
  parseClearCompletionNote,
} from "@/lib/thoughtSaving";
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

  // #792: the only way to delete a stored completion note without sending a
  // replacement. Blank note text is still rejected below, so an emptied field
  // can never clear a note by accident.
  const clear = parseClearCompletionNote(json.body.clearCompletionNote);
  if (!clear.ok) {
    return NextResponse.json({ error: "Invalid clearCompletionNote" }, { status: 400 });
  }
  const clearCompletionNote = clear.value;

  // A clear-only request is still a write, so it takes the ownership and day
  // checks below instead of this shortcut.
  if (thoughtItems.length === 0 && !clearCompletionNote) {
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

  // #948: a client thought id names one thought, so a batch that repeats one is
  // malformed. An id on the completion note is never stored
  // (`storedClientThoughtId` in atomic.ts), so it is not counted.
  const clientThoughtIds = normalized.flatMap((t) =>
    t.timeInSession !== -1 && t.clientThoughtId ? [t.clientThoughtId] : [],
  );
  if (new Set(clientThoughtIds).size !== clientThoughtIds.length) {
    console.warn("Batch thoughts rejected duplicate client thought ids", {
      sessionId,
      userId: auth.user.userId,
      clientThoughtIdCount: clientThoughtIds.length,
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
    clearCompletionNote,
    completionNote,
    rowsToInsert,
  });

  return NextResponse.json({ thoughts: inserted });
});
