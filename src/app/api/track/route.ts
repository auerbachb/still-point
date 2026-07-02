import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isDualTrackEligible } from "@/lib/duration";
import { eq } from "drizzle-orm";

const RETURN_FIELDS = {
  id: users.id,
  email: users.email,
  username: users.username,
  isPublic: users.isPublic,
  currentDay: users.currentDay,
  aphorismsEnabled: users.aphorismsEnabled,
  recoveryTargetDay: users.recoveryTargetDay,
  recoveryCurrentStep: users.recoveryCurrentStep,
  recoveryTotalSteps: users.recoveryTotalSteps,
  dualTrackEnabled: users.dualTrackEnabled,
  secondTrackDay: users.secondTrackDay,
};

/**
 * Opt into the dual-track fork (#240). One-way: enabling a second daily track is
 * only allowed once the primary track has passed the 10-minute mark
 * (`currentDay > FORK_DAY`). Idempotent — enabling an already-enabled account just
 * returns the current state. The second track's day counter (`secondTrackDay`) is
 * left at its default so it starts at 1 minute the first time it is run.
 */
export async function POST() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [current] = await db
      .select({ currentDay: users.currentDay, dualTrackEnabled: users.dualTrackEnabled })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);

    if (!current) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Guard server-side so a client can't flip the flag before reaching the fork.
    if (!current.dualTrackEnabled && !isDualTrackEligible(current.currentDay)) {
      return NextResponse.json(
        { error: "Reach the 10-minute mark before adding a second track." },
        { status: 409 },
      );
    }

    const [updated] = await db
      .update(users)
      .set({ dualTrackEnabled: true, updatedAt: new Date() })
      .where(eq(users.id, auth.userId))
      .returning(RETURN_FIELDS);

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error("Enable dual track error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
