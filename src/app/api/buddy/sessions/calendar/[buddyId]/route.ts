import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  listBuddyCalendarSessionsForBuddy,
  parseBuddyCalendarRange,
} from "@/lib/buddyCalendar";
import { isUuid } from "@/lib/friends";

type Params = { params: Promise<{ buddyId: string }> };

/**
 * Per-buddy shared-session calendar (#350).
 * iOS: mirror `GET /api/buddy/sessions/calendar/[buddyId]` — see `listBuddyCalendarSessionsForBuddy`.
 */
export async function GET(request: Request, context: Params) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { buddyId } = await context.params;
    if (!isUuid(buddyId)) {
      return NextResponse.json({ error: "Invalid buddy id" }, { status: 400 });
    }

    let range;
    try {
      range = parseBuddyCalendarRange(new URL(request.url).searchParams);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "INVALID_FROM_DATE" || msg === "INVALID_TO_DATE") {
        return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
      }
      throw e;
    }

    const result = await listBuddyCalendarSessionsForBuddy(auth.userId, buddyId, range);
    if ("error" in result) {
      if (result.error === "NOT_FRIEND") {
        return NextResponse.json({ error: "Not friends with this user" }, { status: 403 });
      }
      return NextResponse.json({ error: "Invalid buddy" }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Buddy per-buddy calendar GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
