import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { poolDb } from "@/db/pool";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { USERNAME_ERROR, isValidUsername } from "@/lib/username";
import { and, eq, ne, sql } from "drizzle-orm";

const USERNAME_TAKEN_ERROR = "Username already taken";

const RETURN_FIELDS = {
  id: users.id,
  email: users.email,
  username: users.username,
  isPublic: users.isPublic,
  currentDay: users.currentDay,
  aphorismsEnabled: users.aphorismsEnabled,
  dualTrackEnabled: users.dualTrackEnabled,
  secondTrackDay: users.secondTrackDay,
};

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    if (typeof body.username === "string") {
      hasSupportedUpdate = true;
      const username = body.username.trim();
      if (!isValidUsername(username)) {
        return NextResponse.json({ error: USERNAME_ERROR }, { status: 400 });
      }

      // Serialize concurrent username PATCHes targeting the same case-insensitive
      // value: Postgres' unique index on `username` is case-sensitive, so without
      // this advisory lock two requests setting "John" / "john" could both pass
      // the SELECT and both succeed at UPDATE. (Cross-route races with signup are
      // tracked in #8 alongside the case-insensitive unique index.)
      const result = await poolDb.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`username:${username.toLowerCase()}`}))`,
        );

        const existing = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              sql`lower(${users.username}) = lower(${username})`,
              ne(users.id, auth.userId),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          return { taken: true as const };
        }

        updates.username = username;
        const [updated] = await tx
          .update(users)
          .set(updates)
          .where(eq(users.id, auth.userId))
          .returning(RETURN_FIELDS);
        return { taken: false as const, user: updated };
      });

      if (result.taken) {
        return NextResponse.json({ error: USERNAME_TAKEN_ERROR }, { status: 409 });
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
      .where(eq(users.id, auth.userId))
      .returning(RETURN_FIELDS);

    return NextResponse.json({ user: updated });
  } catch (error) {
    // Defensive: if a concurrent signup commits the case-EXACT username between
    // the SELECT inside the transaction and the UPDATE, Postgres' case-sensitive
    // unique index will raise SQLSTATE 23505. Surface as 409 rather than 500.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: unknown }).code === "23505"
    ) {
      return NextResponse.json({ error: USERNAME_TAKEN_ERROR }, { status: 409 });
    }
    console.error("Settings error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
