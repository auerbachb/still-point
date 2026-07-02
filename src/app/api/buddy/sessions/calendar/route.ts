import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { listBuddyCalendarSessions } from "@/lib/buddyCalendar";
import { parseBuddyCalendarRange } from "@/lib/buddyCalendarRange";

/**
 * Unified multi-buddy calendar session list (#350).
 * iOS: mirror `GET /api/buddy/sessions/calendar` — see `listBuddyCalendarSessions`.
 */
export const GET = withApiHandler("Buddy calendar GET", async (request: NextRequest) => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  let range;
  try {
    range = parseBuddyCalendarRange(new URL(request.url).searchParams);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (
      msg === "INVALID_FROM_DATE" ||
      msg === "INVALID_TO_DATE" ||
      msg === "INVALID_DATE_RANGE"
    ) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }
    throw e;
  }

  const result = await listBuddyCalendarSessions(auth.user.userId, range);
  return NextResponse.json(result);
});
