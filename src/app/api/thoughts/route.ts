import { NextResponse } from "next/server";
import { db } from "@/db";
import { thoughts } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { eq, desc, asc } from "drizzle-orm";

export const GET = withApiHandler("Get thoughts", async () => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const userThoughts = await db.select({
    id: thoughts.id,
    sessionId: thoughts.sessionId,
    dayNumber: thoughts.dayNumber,
    timeInSession: thoughts.timeInSession,
    text: thoughts.text,
  })
    .from(thoughts)
    .where(eq(thoughts.userId, auth.user.userId))
    .orderBy(desc(thoughts.dayNumber), asc(thoughts.timeInSession));

  return NextResponse.json({ thoughts: userThoughts });
});
