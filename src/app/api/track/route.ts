import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { isDualTrackEligible } from "@/lib/duration";
import { eq } from "drizzle-orm";

const RETURN_FIELDS = {
  id: users.id,
  email: users.email,
  username: users.username,
  isPublic: users.isPublic,
  currentDay: users.currentDay,
  aphorismsEnabled: users.aphorismsEnabled,
  attentionTrackingEnabled: users.attentionTrackingEnabled,
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
export const POST = withApiHandler("Enable dual track", async () => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const [current] = await db
    .select({ currentDay: users.currentDay, dualTrackEnabled: users.dualTrackEnabled })
    .from(users)
    .where(eq(users.id, auth.user.userId))
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

  if (current.dualTrackEnabled) {
    const [existing] = await db
      .select(RETURN_FIELDS)
      .from(users)
      .where(eq(users.id, auth.user.userId))
      .limit(1);
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ user: existing });
  }

  const [updated] = await db
    .update(users)
    .set({ dualTrackEnabled: true, updatedAt: new Date() })
    .where(eq(users.id, auth.user.userId))
    .returning(RETURN_FIELDS);

  if (!updated) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user: updated });
});
