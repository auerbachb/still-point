import { NextResponse } from "next/server";
import { db } from "@/db";
import { friendships } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { orderedUserPair, isUuid } from "@/lib/friends";
import { and, eq } from "drizzle-orm";

type Params = { params: Promise<{ friendUserId: string }> };

export async function DELETE(_request: Request, context: Params) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { friendUserId } = await context.params;

    if (!isUuid(friendUserId)) {
      return NextResponse.json({ error: "friendUserId must be a valid UUID" }, { status: 400 });
    }
    if (friendUserId === auth.userId) {
      return NextResponse.json({ error: "Invalid friend user id" }, { status: 400 });
    }

    const [u1, u2] = orderedUserPair(auth.userId, friendUserId);

    const removed = await db
      .delete(friendships)
      .where(and(eq(friendships.user1Id, u1), eq(friendships.user2Id, u2)))
      .returning({ user1Id: friendships.user1Id, user2Id: friendships.user2Id });

    if (removed.length === 0) {
      return NextResponse.json({ error: "Not friends with this user" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unfriend error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
