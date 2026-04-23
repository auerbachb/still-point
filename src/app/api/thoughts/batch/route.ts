import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { poolDb } from "@/db/pool";
import { sessions, thoughts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { and, eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId, dayNumber, thoughts: thoughtItems } = await request.json();

    if (!sessionId || !dayNumber || !Array.isArray(thoughtItems)) {
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

    const normalized = thoughtItems
      .map((t: { timeInSession: unknown; text: unknown }) => {
        if (typeof t.timeInSession !== "number" || typeof t.text !== "string") {
          return null;
        }
        const text = t.text.trim().slice(0, 1000);
        if (!text) return null;
        return {
          timeInSession: t.timeInSession,
          text,
        };
      })
      .filter((t): t is { timeInSession: number; text: string } => t != null);

    if (normalized.length === 0) {
      return NextResponse.json({ thoughts: [] });
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

      return tx
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
    });

    return NextResponse.json({ thoughts: inserted });
  } catch (error) {
    console.error("Batch thoughts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
