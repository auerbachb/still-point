import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { buddyDurationForDay } from "@/lib/buddySession";
import { eq } from "drizzle-orm";

export async function POST() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [host] = await db
      .select({ currentDay: users.currentDay })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);
    if (!host) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const durationSeconds = buddyDurationForDay(host.currentDay);
    const shareToken = randomBytes(24).toString("base64url");

    const [session] = await db
      .insert(buddySessions)
      .values({
        shareToken,
        hostUserId: auth.userId,
        durationSeconds,
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

    return NextResponse.json({
      session: {
        id: session.id,
        shareToken: session.shareToken,
        sharePath,
        durationSeconds: session.durationSeconds,
      },
    });
  } catch (error) {
    console.error("Buddy create session error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
