import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { friendRequests, friendships, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { orderedUserPair, isUuid } from "@/lib/friends";
import { sendFriendRequestNotification } from "@/lib/notifications";
import { readJsonObject } from "@/lib/readJsonObject";
import { and, eq, or } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const uid = auth.userId;

    const incomingRows = await db
      .select({
        id: friendRequests.id,
        createdAt: friendRequests.createdAt,
        user: { id: users.id, username: users.username },
      })
      .from(friendRequests)
      .innerJoin(users, eq(friendRequests.fromUserId, users.id))
      .where(and(eq(friendRequests.toUserId, uid), eq(friendRequests.status, "pending")));

    const outgoingRows = await db
      .select({
        id: friendRequests.id,
        createdAt: friendRequests.createdAt,
        user: { id: users.id, username: users.username },
      })
      .from(friendRequests)
      .innerJoin(users, eq(friendRequests.toUserId, users.id))
      .where(and(eq(friendRequests.fromUserId, uid), eq(friendRequests.status, "pending")));

    return NextResponse.json({
      incoming: incomingRows,
      outgoing: outgoingRows,
    });
  } catch (error) {
    console.error("Friend requests list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const json = await readJsonObject(request);
    if (!json.ok) {
      return json.response;
    }

    const toUserId = json.body.toUserId;
    if (!toUserId || typeof toUserId !== "string") {
      return NextResponse.json({ error: "toUserId is required" }, { status: 400 });
    }
    if (!isUuid(toUserId)) {
      return NextResponse.json({ error: "toUserId must be a valid UUID" }, { status: 400 });
    }
    if (toUserId === auth.userId) {
      return NextResponse.json({ error: "Cannot send a friend request to yourself" }, { status: 400 });
    }

    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, toUserId)).limit(1);
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [u1, u2] = orderedUserPair(auth.userId, toUserId);
    const [existingFriend] = await db
      .select({ user1Id: friendships.user1Id })
      .from(friendships)
      .where(and(eq(friendships.user1Id, u1), eq(friendships.user2Id, u2)))
      .limit(1);

    if (existingFriend) {
      return NextResponse.json({ error: "Already friends" }, { status: 409 });
    }

    const [pendingAny] = await db
      .select({ id: friendRequests.id })
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.status, "pending"),
          or(
            and(eq(friendRequests.fromUserId, auth.userId), eq(friendRequests.toUserId, toUserId)),
            and(eq(friendRequests.fromUserId, toUserId), eq(friendRequests.toUserId, auth.userId)),
          ),
        ),
      )
      .limit(1);

    if (pendingAny) {
      return NextResponse.json({ error: "A pending friend request already exists between these users" }, { status: 409 });
    }

    try {
      const [created] = await db
        .insert(friendRequests)
        .values({
          fromUserId: auth.userId,
          toUserId,
          status: "pending",
          updatedAt: new Date(),
        })
        .returning({
          id: friendRequests.id,
          fromUserId: friendRequests.fromUserId,
          toUserId: friendRequests.toUserId,
          status: friendRequests.status,
          createdAt: friendRequests.createdAt,
          updatedAt: friendRequests.updatedAt,
        });

      const [sender] = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, auth.userId))
        .limit(1);

      void sendFriendRequestNotification({
        requestId: created.id,
        recipientUserId: created.toUserId,
        senderUsername: sender?.username ?? "Someone",
      }).catch((error: unknown) => {
        console.error("Friend request notification error:", error);
      });

      return NextResponse.json({ request: created }, { status: 201 });
    } catch (e: unknown) {
      const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
      if (code === "23505") {
        return NextResponse.json(
          { error: "A pending friend request already exists between these users" },
          { status: 409 },
        );
      }
      throw e;
    }
  } catch (error) {
    console.error("Friend request create error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
