import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { atomicCreateBuddySession } from "@/db/atomic";
import { users } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { normalizedBuddySessionDurationSeconds } from "@/lib/buddySession";
import { readBuddySessionCreateBody } from "@/lib/buddySessionCreateBody";
import { GOOGLE_CALENDAR_SYNC_FAILED_MESSAGE, syncBuddySessionCalendarForUser } from "@/lib/googleCalendar";
import { eq } from "drizzle-orm";

export const POST = withApiHandler("Buddy create session", async (request: NextRequest) => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const createBody = await readBuddySessionCreateBody(request);
  if (createBody instanceof NextResponse) return createBody;
  const { scheduledStartAt } = createBody;

  const [host] = await db
    .select({ currentDay: users.currentDay })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);
  if (!host) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const durationSeconds = normalizedBuddySessionDurationSeconds([host.currentDay]);
  const shareToken = randomBytes(24).toString("base64url");

  const session = await atomicCreateBuddySession({
    shareToken,
    hostUserId: auth.user.userId,
    durationSeconds,
    scheduledStartAt,
  });

  if (!session) {
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }

  const sharePath = `/app?buddy=${encodeURIComponent(shareToken)}`;
  let calendarSync: Awaited<ReturnType<typeof syncBuddySessionCalendarForUser>>[] = [];
  if (session.scheduledStartAt) {
    try {
      calendarSync = [await syncBuddySessionCalendarForUser(session, auth.user.userId)];
    } catch (syncError) {
      console.error("Buddy create Google Calendar sync error:", syncError);
      calendarSync = [
        {
          status: "failed",
          userId: auth.user.userId,
          error: GOOGLE_CALENDAR_SYNC_FAILED_MESSAGE,
        },
      ];
    }
  }

  return NextResponse.json({
    session: {
      id: session.id,
      shareToken: session.shareToken,
      sharePath,
      durationSeconds: session.durationSeconds,
      scheduledStartAt: session.scheduledStartAt?.toISOString() ?? null,
      calendarSync,
    },
  });
});
