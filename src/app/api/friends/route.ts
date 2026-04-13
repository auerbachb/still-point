import { NextResponse } from "next/server";
import { db } from "@/db";
import { friendships, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const uid = auth.userId;

    const friendSelect = { id: users.id, username: users.username };

    const asUser1 = db
      .select(friendSelect)
      .from(friendships)
      .innerJoin(users, eq(friendships.user2Id, users.id))
      .where(eq(friendships.user1Id, uid));

    const asUser2 = db
      .select(friendSelect)
      .from(friendships)
      .innerJoin(users, eq(friendships.user1Id, users.id))
      .where(eq(friendships.user2Id, uid));

    const rows = await asUser1.union(asUser2);

    return NextResponse.json({ friends: rows });
  } catch (error) {
    console.error("Friends list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
