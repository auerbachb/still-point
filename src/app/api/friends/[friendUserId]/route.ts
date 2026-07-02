import { NextResponse } from "next/server";
import { db } from "@/db";
import { friendships } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { orderedUserPair, isUuid } from "@/lib/friends";
import { and, eq } from "drizzle-orm";

export const DELETE = withApiHandler(
  "Unfriend",
  async (_request, context) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { friendUserId } = await (context as { params: Promise<{ friendUserId: string }> }).params;

    if (!isUuid(friendUserId)) {
      return NextResponse.json({ error: "friendUserId must be a valid UUID" }, { status: 400 });
    }
    if (friendUserId === auth.user.userId) {
      return NextResponse.json({ error: "Invalid friend user id" }, { status: 400 });
    }

    const [u1, u2] = orderedUserPair(auth.user.userId, friendUserId);

    const removed = await db
      .delete(friendships)
      .where(and(eq(friendships.user1Id, u1), eq(friendships.user2Id, u2)))
      .returning({ user1Id: friendships.user1Id, user2Id: friendships.user2Id });

    if (removed.length === 0) {
      return NextResponse.json({ error: "Not friends with this user" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  },
);
