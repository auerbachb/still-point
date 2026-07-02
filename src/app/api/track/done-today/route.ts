import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isValidSessionCalendarDate } from "@/lib/sessionCalendar";

export async function GET(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const date = request.nextUrl.searchParams.get("date");
    if (!date || !isValidSessionCalendarDate(date)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const completedTracks = await db
      .select({ track: sessions.track })
      .from(sessions)
      .where(and(
        eq(sessions.userId, auth.userId),
        eq(sessions.sessionDate, date),
        eq(sessions.completed, true),
        eq(sessions.sessionType, "standard"),
        inArray(sessions.track, ["primary", "second"]),
      ));

    return NextResponse.json({
      tracksDoneToday: {
        primary: completedTracks.some((session) => session.track === "primary"),
        second: completedTracks.some((session) => session.track === "second"),
      },
    });
  } catch (error) {
    console.error("Get track completion error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
