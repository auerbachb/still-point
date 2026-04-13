import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { and, eq, ilike, ne } from "drizzle-orm";

const MIN_LEN = 2;
const LIMIT = 20;

export async function GET(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < MIN_LEN) {
      return NextResponse.json({ users: [] });
    }

    const escaped = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const pattern = `%${escaped}%`;

    const rows = await db
      .select({
        id: users.id,
        username: users.username,
      })
      .from(users)
      .where(
        and(
          eq(users.isPublic, true),
          ne(users.id, auth.userId),
          ilike(users.username, pattern),
        ),
      )
      .limit(LIMIT);

    return NextResponse.json({ users: rows });
  } catch (error) {
    console.error("Friends search error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
