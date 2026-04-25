import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { poolDb } from "@/db/pool";
import { sessions, thoughts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasRejectedSubmittedThoughts, normalizeThoughtInputs } from "@/lib/thoughtSaving";
import { and, eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId, dayNumber, thoughts: thoughtItems } = await request.json();

    if (
      typeof sessionId !== "string" ||
      sessionId.length === 0 ||
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
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
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
        userId: auth.userId,
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
        userId: auth.userId,
        completionNoteCount,
      });
      return NextResponse.json({ error: "Invalid thoughts payload" }, { status: 400 });
    }

    const completionNote = normalized.filter((t) => t.timeInSession === -1).at(-1);
    const rowsToInsert = [
      ...normalized.filter((t) => t.timeInSession !== -1),
      ...(completionNote ? [completionNote] : []),
    ];

    const inserted = await poolDb.transaction(async (tx) => {
      if (completionNote) {
        await tx
          .delete(thoughts)
          .where(
            and(
              eq(thoughts.sessionId, sessionId),
              eq(thoughts.userId, auth.userId),
              eq(thoughts.timeInSession, -1),
            ),
          );
      }

      if (rowsToInsert.length === 0) {
        return [];
      }

      const insertedThoughts = await tx
        .insert(thoughts)
        .values(
          rowsToInsert.map((t) => ({
            userId: auth.userId,
            sessionId,
            dayNumber,
            timeInSession: t.timeInSession,
            text: t.text,
          })),
        )
        .returning({
          id: thoughts.id,
          sessionId: thoughts.sessionId,
          dayNumber: thoughts.dayNumber,
          timeInSession: thoughts.timeInSession,
          text: thoughts.text,
        });
      if (insertedThoughts.length !== rowsToInsert.length) {
        throw new Error("THOUGHT_INSERT_MISMATCH");
      }
      return insertedThoughts;
    });

    return NextResponse.json({ thoughts: inserted });
  } catch (error) {
    console.error("Batch thoughts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
