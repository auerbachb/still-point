import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { thoughts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

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

    const values = thoughtItems.map((t: { timeInSession: number; text: string }) => ({
      userId: auth.userId,
      sessionId,
      dayNumber,
      timeInSession: t.timeInSession,
      text: t.text,
    }));

    const inserted = await db.insert(thoughts).values(values).returning({
      id: thoughts.id,
      dayNumber: thoughts.dayNumber,
      timeInSession: thoughts.timeInSession,
      text: thoughts.text,
    });

    return NextResponse.json({ thoughts: inserted });
  } catch (error) {
    console.error("Batch thoughts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
