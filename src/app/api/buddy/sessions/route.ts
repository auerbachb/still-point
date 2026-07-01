import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { normalizedBuddySessionDurationSeconds } from "@/lib/buddySession";
import { readBuddySessionCreateBody } from "@/lib/buddySessionCreateBody";
import { GOOGLE_CALENDAR_SYNC_FAILED_MESSAGE, syncBuddySessionCalendarForUser } from "@/lib/googleCalendar";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const createBody = await readBuddySessionCreateBody(request);
    if (createBody instanceof NextResponse) return createBody;
    const { scheduledStartAt } = createBody;

    const [host] = await db
      .select({ currentDay: users.currentDay })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);
    if (!host) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const durationSeconds = normalizedBuddySessionDurationSeconds([host.currentDay]);
    const shareToken = randomBytes(24).toString("base64url");

    const [session] = await db
      .insert(buddySessions)
      .values({
        shareToken,
        hostUserId: auth.userId,
        durationSeconds,
        scheduledStartAt,
        state: "waiting",
      })
      .returning();

    if (!session) {
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    await db.insert(buddySessionParticipants).values({
      buddySessionId: session.id,
      userId: auth.userId,
      isHost: true,
      ready: false,
    });

    const sharePath = `/app?buddy=${encodeURIComponent(shareToken)}`;
    let calendarSync: Awaited<ReturnType<typeof syncBuddySessionCalendarForUser>>[] = [];
    if (session.scheduledStartAt) {
      try {
        calendarSync = [await syncBuddySessionCalendarForUser(session, auth.userId)];
      } catch (syncError) {
        console.error("Buddy create Google Calendar sync error:", syncError);
        calendarSync = [
          {
            status: "failed",
            userId: auth.userId,
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
  } catch (error) {
    console.error("Buddy create session error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
