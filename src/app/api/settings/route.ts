import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { and, eq, ne, sql } from "drizzle-orm";

const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const USERNAME_ERROR =
  "Username must be 3-30 characters (letters, numbers, underscores)";
const USERNAME_TAKEN_ERROR = "Username already taken";

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof body.isPublic === "boolean") {
      updates.isPublic = body.isPublic;
    }

    if (typeof body.username === "string") {
      const username = body.username.trim();
      if (
        username.length < 3 ||
        username.length > 30 ||
        !USERNAME_REGEX.test(username)
      ) {
        return NextResponse.json({ error: USERNAME_ERROR }, { status: 400 });
      }

      const existing = await db
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
        return NextResponse.json({ error: USERNAME_TAKEN_ERROR }, { status: 409 });
      }

      updates.username = username;
    }

    const [updated] = await db.update(users)
      .set(updates)
      .where(eq(users.id, auth.userId))
      .returning({
        id: users.id,
        email: users.email,
        username: users.username,
        isPublic: users.isPublic,
        currentDay: users.currentDay,
      });

    return NextResponse.json({ user: updated });
  } catch (error) {
    // Backstop in case a concurrent insert/update wins the race after the
    // explicit uniqueness check — Postgres unique-violation is SQLSTATE 23505.
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
