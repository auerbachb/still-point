import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { buddySessions, buddySessionParticipants } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { RouteParams, withApiHandler } from "@/lib/api/withApiHandler";
import {
  bumpBuddyRevision,
  reconcileBuddySession,
} from "@/lib/buddySession";
import {
  requireBuddyActiveParticipant,
  requireLobbyForReady,
} from "@/lib/buddySessionControlsPolicy";
import { isUuid } from "@/lib/friends";
import { readJsonObject } from "@/lib/readJsonObject";
import { and, eq } from "drizzle-orm";

type RouteContext = RouteParams<{ id: string }>;

export const PATCH = withApiHandler(
  "Buddy ready PATCH",
  async (request: NextRequest, context: RouteContext) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { id: sessionId } = await context.params;
    if (!isUuid(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const json = await readJsonObject(request);
    if (!json.ok) return json.response;
    const ready = json.body.ready;
    if (typeof ready !== "boolean") {
      return NextResponse.json({ error: "ready must be a boolean" }, { status: 400 });
    }

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, sessionId))
      .limit(1);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const lobbyErr = requireLobbyForReady(session);
    if (lobbyErr) return lobbyErr;

    const [p] = await db
      .select()
      .from(buddySessionParticipants)
      .where(
        and(
          eq(buddySessionParticipants.buddySessionId, sessionId),
          eq(buddySessionParticipants.userId, auth.user.userId),
        ),
      )
      .limit(1);

    const memberErr = requireBuddyActiveParticipant(p);
    if (memberErr) return memberErr;

    await db
      .update(buddySessionParticipants)
      .set({ ready, lastSeenAt: new Date() })
      .where(eq(buddySessionParticipants.id, p.id));

    await bumpBuddyRevision(sessionId);
    await reconcileBuddySession(sessionId);

    return NextResponse.json({ ok: true });
  },
);