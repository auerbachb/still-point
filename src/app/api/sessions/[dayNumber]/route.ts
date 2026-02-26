import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, thoughts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, and, asc } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dayNumber: string }> }
) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { dayNumber } = await params;
    const dayNum = parseInt(dayNumber, 10);
    if (isNaN(dayNum)) {
      return NextResponse.json({ error: "Invalid day number" }, { status: 400 });
    }

    const [session] = await db.select()
      .from(sessions)
      .where(and(
        eq(sessions.userId, auth.userId),
        eq(sessions.dayNumber, dayNum),
      ))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sessionThoughts = await db.select({
      id: thoughts.id,
      dayNumber: thoughts.dayNumber,
      timeInSession: thoughts.timeInSession,
      text: thoughts.text,
    })
      .from(thoughts)
      .where(eq(thoughts.sessionId, session.id))
      .orderBy(asc(thoughts.timeInSession));

    return NextResponse.json({ session, thoughts: sessionThoughts });
  } catch (error) {
    console.error("Get session error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
