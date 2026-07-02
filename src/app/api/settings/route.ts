import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { atomicUpdateUsername } from "@/db/atomic";
import { users } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { isUniqueViolation } from "@/lib/dbErrors";
import { USERNAME_ERROR, isValidUsername } from "@/lib/username";
import { eq } from "drizzle-orm";

const USERNAME_TAKEN_ERROR = "Username already taken";

const RETURN_FIELDS = {
  id: users.id,
  email: users.email,
  username: users.username,
  isPublic: users.isPublic,
  currentDay: users.currentDay,
  aphorismsEnabled: users.aphorismsEnabled,
  attentionTrackingEnabled: users.attentionTrackingEnabled,
  dualTrackEnabled: users.dualTrackEnabled,
  secondTrackDay: users.secondTrackDay,
};

export const PATCH = withApiHandler(
  "Settings",
  async (request: NextRequest) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    let hasSupportedUpdate = false;

    if (typeof body.isPublic === "boolean") {
      updates.isPublic = body.isPublic;
      hasSupportedUpdate = true;
    }

    if (typeof body.aphorismsEnabled === "boolean") {
      updates.aphorismsEnabled = body.aphorismsEnabled;
      hasSupportedUpdate = true;
    }

    if (typeof body.attentionTrackingEnabled === "boolean") {
      updates.attentionTrackingEnabled = body.attentionTrackingEnabled;
      hasSupportedUpdate = true;
    }

    if (typeof body.username === "string") {
      hasSupportedUpdate = true;
      const username = body.username.trim();
      if (!isValidUsername(username)) {
        return NextResponse.json({ error: USERNAME_ERROR }, { status: 400 });
      }

      // Case-insensitive uniqueness is enforced by `users_username_lower_unique`.
      // The NOT EXISTS guard gives a clean 409; concurrent races surface as 23505.
      const result = await atomicUpdateUsername({
        userId: auth.user.userId,
        username,
        updates,
      });

      if (!result.ok) {
        if (result.reason === "taken") {
          return NextResponse.json({ error: USERNAME_TAKEN_ERROR }, { status: 409 });
        }
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json({ user: result.user });
    }

    if (!hasSupportedUpdate) {
      return NextResponse.json(
        { error: "No supported settings provided" },
        { status: 400 },
      );
    }

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, auth.user.userId))
      .returning(RETURN_FIELDS);

    return NextResponse.json({ user: updated });
  },
  {
    mapError: (error) => {
      if (isUniqueViolation(error)) {
        return NextResponse.json({ error: USERNAME_TAKEN_ERROR }, { status: 409 });
      }
      return null;
    },
  },
);
