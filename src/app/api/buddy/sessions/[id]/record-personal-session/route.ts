import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { atomicRecordBuddyPersonalSession } from "@/db/atomic";
import {
  buddySessionParticipants,
  buddySessions,
  sessions,
} from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { RouteParams, withApiHandler } from "@/lib/api/withApiHandler";
import { isUuid } from "@/lib/friends";
import { reconcileBuddySession } from "@/lib/buddySession";
import {
  requireBuddyActiveParticipant,
  requireBuddySessionCompletedForPersonalRecord,
} from "@/lib/buddySessionControlsPolicy";
import { hasRejectedSubmittedThoughts, normalizeThoughtInputs } from "@/lib/thoughtSaving";
import { isUniqueViolation } from "@/lib/dbErrors";
import { and, eq } from "drizzle-orm";

type RouteContext = RouteParams<{ id: string }>;

function parseMindStateLog(raw: unknown): Array<{ time: number; state: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ time: number; state: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const t = (item as { time?: unknown }).time;
    const s = (item as { state?: unknown }).state;
    if (typeof t !== "number" || typeof s !== "string") continue;
    out.push({ time: t, state: s });
  }
  return out;
}

function sessionDateOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * #119: After the shared sit completes, create this user's own `sessions` row (idempotent)
 * and optional in-sit `thoughts`. Journal completion notes use POST /api/thoughts/batch.
 */
export const POST = withApiHandler(
  "Buddy record-personal-session",
  async (request: NextRequest, context: RouteContext) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { id: sessionId } = await context.params;
    if (!isUuid(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    await reconcileBuddySession(sessionId);

    const [buddyRow] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, sessionId))
      .limit(1);

    const phaseErr = requireBuddySessionCompletedForPersonalRecord(buddyRow);
    if (phaseErr) return phaseErr;

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

    const [existing] = await db
      .select()
      .from(sessions)
      .where(
        and(eq(sessions.userId, auth.user.userId), eq(sessions.buddySessionId, sessionId)),
      )
      .limit(1);

    if (existing) {
      return NextResponse.json({ session: existing, already: true });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const sessionDateRaw = body.sessionDate;
    if (typeof sessionDateRaw !== "string" || !sessionDateOk(sessionDateRaw)) {
      return NextResponse.json({ error: "Invalid or missing sessionDate" }, { status: 400 });
    }

    const clearPercentRaw = body.clearPercent;
    if (typeof clearPercentRaw !== "number" || Number.isNaN(clearPercentRaw)) {
      return NextResponse.json({ error: "Invalid clearPercent" }, { status: 400 });
    }
    const clearPercent = Math.max(0, Math.min(100, Math.round(clearPercentRaw)));

    const thoughtCountRaw = body.thoughtCount;
    const thoughtCount =
      typeof thoughtCountRaw === "number" && !Number.isNaN(thoughtCountRaw)
        ? Math.max(0, Math.min(10_000, Math.floor(thoughtCountRaw)))
        : 0;

    const mindStateLog = parseMindStateLog(body.mindStateLog);
    if (body.thoughts != null && !Array.isArray(body.thoughts)) {
      console.warn("Buddy personal session rejected invalid thoughts payload", {
        buddySessionId: sessionId,
        submittedType: typeof body.thoughts,
      });
      return NextResponse.json({ error: "Invalid thoughts payload" }, { status: 400 });
    }
    const normalizedThoughts = normalizeThoughtInputs(body.thoughts);
    if (hasRejectedSubmittedThoughts(normalizedThoughts)) {
      console.warn("Buddy personal session rejected invalid thoughts payload", {
        buddySessionId: sessionId,
        submittedCount: normalizedThoughts.submittedCount,
        invalidCount: normalizedThoughts.invalidCount,
      });
      return NextResponse.json({ error: "Invalid thoughts payload" }, { status: 400 });
    }
    const thoughtItems = normalizedThoughts.thoughts;

    const duration = buddyRow!.durationSeconds;
    let actualTime = duration;
    const at = body.actualTime;
    if (typeof at === "number" && !Number.isNaN(at)) {
      actualTime = Math.max(0, Math.min(duration * 2, Math.round(at)));
    }

    const now = new Date();
    const participantCompletedAt = p!.participantCompletedAt ?? now;

    try {
      const row = await atomicRecordBuddyPersonalSession({
        userId: auth.user.userId,
        buddySessionId: sessionId,
        participantId: p!.id,
        sessionDate: sessionDateRaw,
        duration,
        actualTime,
        clearPercent,
        thoughtCount,
        mindStateLog,
        participantCompletedAt,
        now,
        thoughtItems,
      });

      if (row === "USER_NOT_FOUND") {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      return NextResponse.json({ session: row });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const [again] = await db
          .select()
          .from(sessions)
          .where(
            and(eq(sessions.userId, auth.user.userId), eq(sessions.buddySessionId, sessionId)),
          )
          .limit(1);
        if (again) {
          return NextResponse.json({ session: again, already: true });
        }
      }
      throw err;
    }
  },
);