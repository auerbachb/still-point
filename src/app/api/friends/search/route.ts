import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { and, eq, ilike, ne } from "drizzle-orm";

const MIN_LEN = 2;
const LIMIT = 20;

export const GET = withApiHandler("Friends search", async (request: NextRequest) => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const q = (request!.nextUrl.searchParams.get("q") ?? "").trim();
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
        ne(users.id, auth.user.userId),
        ilike(users.username, pattern),
      ),
    )
    .limit(LIMIT);

  return NextResponse.json({ users: rows });
});
