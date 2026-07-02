import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { poolDb } from "@/db/pool";
import { friendRequests, friendships } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { orderedUserPair, isUuid } from "@/lib/friends";
import { readJsonObject } from "@/lib/readJsonObject";
import { and, eq, ne } from "drizzle-orm";

export const PATCH = withApiHandler(
  "Friend request patch",
  async (request: NextRequest, context) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { id } = await (context as { params: Promise<{ id: string }> }).params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid request id" }, { status: 400 });
    }

    const json = await readJsonObject(request);
    if (!json.ok) {
      return json.response;
    }

    const action = json.body.action;
    if (typeof action !== "string") {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }
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
      if (row.fromUserId !== auth.user.userId) {
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
      if (!updated) {
        return NextResponse.json(
          { error: "Request changed concurrently; try again" },
          { status: 409 },
        );
      }
      return NextResponse.json({ request: updated });
    }

    if (row.toUserId !== auth.user.userId) {
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
      if (!updated) {
        return NextResponse.json(
          { error: "Request changed concurrently; try again" },
          { status: 409 },
        );
      }
      return NextResponse.json({ request: updated });
    }

    // accept — single transaction so friendship is not orphaned if insert fails
    const [u1, u2] = orderedUserPair(row.fromUserId, row.toUserId);

    const updated = await poolDb.transaction(async (tx) => {
      const [u] = await tx
        .update(friendRequests)
        .set({ status: "accepted", updatedAt: new Date() })
        .where(
          and(
            eq(friendRequests.id, id),
            eq(friendRequests.status, "pending"),
            eq(friendRequests.toUserId, auth.user.userId),
          ),
        )
        .returning({
          id: friendRequests.id,
          fromUserId: friendRequests.fromUserId,
          toUserId: friendRequests.toUserId,
          status: friendRequests.status,
          updatedAt: friendRequests.updatedAt,
        });

      if (!u) {
        return null;
      }

      await tx.insert(friendships).values({ user1Id: u1, user2Id: u2 }).onConflictDoNothing();

      // Clear any legacy reverse-direction pending row for the same pair (pre-LEAST/GREATEST index DBs).
      await tx
        .update(friendRequests)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            ne(friendRequests.id, id),
            eq(friendRequests.fromUserId, row.toUserId),
            eq(friendRequests.toUserId, row.fromUserId),
            eq(friendRequests.status, "pending"),
          ),
        );

      return u;
    });

    if (!updated) {
      return NextResponse.json({ error: "Could not accept this request" }, { status: 409 });
    }

    return NextResponse.json({ request: updated });
  },
);
