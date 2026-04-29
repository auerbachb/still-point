import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { poolDb } from "@/db/pool";
import {
  buddySessionParticipants,
  buddySessions,
  sessions,
  thoughts,
  users,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isUuid } from "@/lib/friends";
import { reconcileBuddySession } from "@/lib/buddySession";
import {
  requireBuddyActiveParticipant,
  requireBuddySessionCompletedForPersonalRecord,
} from "@/lib/buddySessionControlsPolicy";
import { hasRejectedSubmittedThoughts, normalizeThoughtInputs } from "@/lib/thoughtSaving";
import { and, eq, sql } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const o = e as { code?: string; cause?: unknown };
  if (o.code === "23505") return true;
  if (o.cause) return isUniqueViolation(o.cause);
  return false;
}

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
 * #119: After the shared sit completes, create this user’s own `sessions` row (idempotent)
 * and optional in-sit `thoughts`. Journal completion notes use POST /api/thoughts/batch.
 */
export async function POST(request: NextRequest, context: Params) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
          eq(buddySessionParticipants.userId, auth.userId),
        ),
      )
      .limit(1);

    const memberErr = requireBuddyActiveParticipant(p);
    if (memberErr) return memberErr;

    const [existing] = await db
      .select()
      .from(sessions)
      .where(
        and(eq(sessions.userId, auth.userId), eq(sessions.buddySessionId, sessionId)),
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
        userId: auth.userId,
        submittedType: typeof body.thoughts,
      });
      return NextResponse.json({ error: "Invalid thoughts payload" }, { status: 400 });
    }
    const normalizedThoughts = normalizeThoughtInputs(body.thoughts);
    if (hasRejectedSubmittedThoughts(normalizedThoughts)) {
      console.warn("Buddy personal session rejected invalid thoughts payload", {
        buddySessionId: sessionId,
        userId: auth.userId,
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
      const row = await poolDb.transaction(async (tx) => {
        const [u] = await tx
          .select({ currentDay: users.currentDay })
          .from(users)
          .where(eq(users.id, auth.userId))
          .limit(1);
        if (!u) {
          throw new Error("USER_NOT_FOUND");
        }
        const dayNumber = u.currentDay;

        const [created] = await tx
          .insert(sessions)
          .values({
            userId: auth.userId,
            buddySessionId: sessionId,
            dayNumber,
            sessionType: "standard",
            duration,
            completed: true,
            actualTime,
            clearPercent,
            thoughtCount,
            mindStateLog,
            sessionDate: sessionDateRaw,
          })
          .returning();

        if (!created) {
          throw new Error("SESSION_INSERT_FAILED");
        }

        await tx
          .update(users)
          .set({
            currentDay: sql`${users.currentDay} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, auth.userId));

        await tx
          .update(buddySessionParticipants)
          .set({
            participantCompletedAt,
            lastSeenAt: now,
          })
          .where(eq(buddySessionParticipants.id, p!.id));

        await tx
          .update(buddySessions)
          .set({
            revision: sql`${buddySessions.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(buddySessions.id, sessionId));

        if (thoughtItems.length > 0) {
          const insertedThoughts = await tx
            .insert(thoughts)
            .values(
              thoughtItems.map((t) => ({
                userId: auth.userId,
                sessionId: created.id,
                dayNumber,
                timeInSession: t.timeInSession,
                text: t.text,
              })),
            )
            .returning({ id: thoughts.id });
          if (insertedThoughts.length !== thoughtItems.length) {
            throw new Error("THOUGHT_INSERT_MISMATCH");
          }
        }

        return created;
      });

      return NextResponse.json({ session: row });
    } catch (err) {
      if ((err as Error)?.message === "USER_NOT_FOUND") {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      if (isUniqueViolation(err)) {
        const [again] = await db
          .select()
          .from(sessions)
          .where(
            and(eq(sessions.userId, auth.userId), eq(sessions.buddySessionId, sessionId)),
          )
          .limit(1);
        if (again) {
          return NextResponse.json({ session: again, already: true });
        }
      }
      throw err;
    }
  } catch (error) {
    console.error("Buddy record-personal-session error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
