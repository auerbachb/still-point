import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { RouteParams, withApiHandler } from "@/lib/api/withApiHandler";
import { listBuddyCalendarSessionsForBuddy } from "@/lib/buddyCalendar";
import { parseBuddyCalendarRange } from "@/lib/buddyCalendarRange";
import { isUuid } from "@/lib/friends";

type RouteContext = RouteParams<{ buddyId: string }>;

/**
 * Per-buddy shared-session calendar (#350).
 * iOS: mirror `GET /api/buddy/sessions/calendar/[buddyId]` — see `listBuddyCalendarSessionsForBuddy`.
 */
export const GET = withApiHandler(
  "Buddy per-buddy calendar GET",
  async (request: NextRequest, context: RouteContext) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { buddyId } = await context.params;
    if (!isUuid(buddyId)) {
      return NextResponse.json({ error: "Invalid buddy id" }, { status: 400 });
    }

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

    const result = await listBuddyCalendarSessionsForBuddy(auth.user.userId, buddyId, range);
    if ("error" in result) {
      if (result.error === "NOT_FRIEND") {
        return NextResponse.json({ error: "Not friends with this user" }, { status: 403 });
      }
      return NextResponse.json({ error: "Invalid buddy" }, { status: 400 });
    }

    return NextResponse.json(result);
  },
);