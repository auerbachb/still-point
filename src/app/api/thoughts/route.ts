import { NextResponse } from "next/server";
import { db } from "@/db";
import { thoughts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, desc, asc } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userThoughts = await db.select({
      id: thoughts.id,
      sessionId: thoughts.sessionId,
      dayNumber: thoughts.dayNumber,
      timeInSession: thoughts.timeInSession,
      text: thoughts.text,
    })
      .from(thoughts)
      .where(eq(thoughts.userId, auth.userId))
      .orderBy(desc(thoughts.dayNumber), asc(thoughts.timeInSession));

    return NextResponse.json({ thoughts: userThoughts });
  } catch (error) {
    console.error("Get thoughts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
