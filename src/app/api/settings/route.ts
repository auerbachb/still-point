import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const updates: Record<string, any> = { updatedAt: new Date() };

    if (typeof body.isPublic === "boolean") {
      updates.isPublic = body.isPublic;
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
    console.error("Settings error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
