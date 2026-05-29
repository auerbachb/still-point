import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  listBuddyCalendarSessions,
  parseBuddyCalendarRange,
} from "@/lib/buddyCalendar";

/**
 * Unified multi-buddy calendar session list (#350).
 * iOS: mirror `GET /api/buddy/sessions/calendar` — see `listBuddyCalendarSessions`.
 */
export async function GET(request: Request) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    const result = await listBuddyCalendarSessions(auth.userId, range);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Buddy calendar GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
