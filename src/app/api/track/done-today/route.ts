import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { isValidSessionCalendarDate, tracksCredited } from "@/lib/sessionCalendar";

export const GET = withApiHandler(
  "Get track completion",
  async (request: NextRequest) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const date = request.nextUrl.searchParams.get("date");
    if (!date || !isValidSessionCalendarDate(date)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const completedTracks = await db
      .select({ track: sessions.track, combined: sessions.combined })
      .from(sessions)
      .where(and(
        eq(sessions.userId, auth.user.userId),
        eq(sessions.sessionDate, date),
        eq(sessions.completed, true),
        eq(sessions.sessionType, "standard"),
        inArray(sessions.track, ["primary", "second"]),
      ));
    // #769: a combined sit is one primary row that counts for both tracks.
    const credited = completedTracks.map(tracksCredited);

    return NextResponse.json({
      tracksDoneToday: {
        primary: credited.some((tracks) => tracks.primary),
        second: credited.some((tracks) => tracks.second),
      },
    });
  },
);
