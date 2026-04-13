import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { friendRequests, friendships } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { orderedUserPair } from "@/lib/friends";
import { and, eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Params) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    let body: { action?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const action = body.action;
    if (action !== "accept" && action !== "reject" && action !== "cancel") {
      return NextResponse.json(
        { error: "action must be \"accept\", \"reject\", or \"cancel\"" },
        { status: 400 },
      );
    }

    const [row] = await db.select().from(friendRequests).where(eq(friendRequests.id, id)).limit(1);

    if (!row) {
      return NextResponse.json({ error: "Friend request not found" }, { status: 404 });
    }

    if (row.status !== "pending") {
      return NextResponse.json({ error: "This friend request is no longer pending" }, { status: 409 });
    }

    if (action === "cancel") {
      if (row.fromUserId !== auth.userId) {
        return NextResponse.json({ error: "Only the sender can cancel this request" }, { status: 403 });
      }
      const [updated] = await db
        .update(friendRequests)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(friendRequests.id, id), eq(friendRequests.status, "pending")))
        .returning({
          id: friendRequests.id,
          status: friendRequests.status,
          updatedAt: friendRequests.updatedAt,
        });
      return NextResponse.json({ request: updated });
    }

    if (row.toUserId !== auth.userId) {
      return NextResponse.json({ error: "Only the recipient can accept or reject this request" }, { status: 403 });
    }

    if (action === "reject") {
      const [updated] = await db
        .update(friendRequests)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(and(eq(friendRequests.id, id), eq(friendRequests.status, "pending")))
        .returning({
          id: friendRequests.id,
          status: friendRequests.status,
          updatedAt: friendRequests.updatedAt,
        });
      return NextResponse.json({ request: updated });
    }

    // accept
    const [u1, u2] = orderedUserPair(row.fromUserId, row.toUserId);

    const [updated] = await db
      .update(friendRequests)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(
        and(
          eq(friendRequests.id, id),
          eq(friendRequests.status, "pending"),
          eq(friendRequests.toUserId, auth.userId),
        ),
      )
      .returning({
        id: friendRequests.id,
        fromUserId: friendRequests.fromUserId,
        toUserId: friendRequests.toUserId,
        status: friendRequests.status,
        updatedAt: friendRequests.updatedAt,
      });

    if (!updated) {
      return NextResponse.json({ error: "Could not accept this request" }, { status: 409 });
    }

    await db.insert(friendships).values({ user1Id: u1, user2Id: u2 }).onConflictDoNothing();

    return NextResponse.json({ request: updated });
  } catch (error) {
    console.error("Friend request patch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
