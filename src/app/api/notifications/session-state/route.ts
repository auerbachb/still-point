import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { getOrCreateNotificationPreferences } from "@/lib/notification-preferences";
import { sessionActiveUntilFrom } from "@/lib/notifications/session-active";
import { applyKeyedSessionState, isSessionKey } from "@/lib/notifications/session-holds";
import { readJsonObject } from "@/lib/readJsonObject";

/**
 * Clients report whether a sit is running so the server can withhold Still Point's
 * own pushes for the duration (#709).
 *
 * `active: true` stores a TTL-bounded `session_active_until`; clients refresh it on
 * a heartbeat while the sit runs and POST `active: false` when it ends. Users who
 * turned the "During sessions" toggle off are not tracked at all — the write is
 * gated on `suppressDuringSession`, so opting out keeps notifications flowing.
 */
export const POST = withApiHandler(
  "Notification session-state POST",
  async (request: NextRequest) => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const json = await readJsonObject(request);
    if (!json.ok) return json.response;

    const { active, sessionKey } = json.body;
    if (typeof active !== "boolean") {
      return NextResponse.json({ error: "active must be a boolean" }, { status: 400 });
    }
    // Absent or null keeps the legacy single-column write. A present value must
    // name one sit; a non-string or blank key would otherwise collapse every
    // such client onto one shared row.
    if (sessionKey != null && !isSessionKey(sessionKey)) {
      return NextResponse.json({ error: "sessionKey must be a non-empty string" }, { status: 400 });
    }

    const prefs = await getOrCreateNotificationPreferences(auth.user.userId);

    if (isSessionKey(sessionKey)) {
      const keyed = await applyKeyedSessionState({
        userId: auth.user.userId,
        sessionKey,
        active,
        suppressDuringSession: prefs.suppressDuringSession,
      });
      return NextResponse.json(keyed);
    }
    const sessionActiveUntil = active && prefs.suppressDuringSession ? sessionActiveUntilFrom() : null;

    if (sessionActiveUntil !== null) {
      // The preference is re-checked in the WHERE clause rather than trusted from
      // the read above: the two are separate statements, so a "During sessions"
      // toggle-off landing between them would otherwise be overwritten by this
      // heartbeat and re-suppress the user for a full TTL. `returning()` reports
      // what actually landed, so the response cannot claim a hold the conditional
      // update declined to take.
      const [row] = await db
        .update(notificationPreferences)
        // `updatedAt` is deliberately untouched: a heartbeat is not a preference
        // edit, and bumping it every 60s would churn the row clients sync on.
        .set({ sessionActiveUntil })
        .where(
          and(
            eq(notificationPreferences.userId, auth.user.userId),
            eq(notificationPreferences.suppressDuringSession, true),
          ),
        )
        .returning({
          sessionActiveUntil: notificationPreferences.sessionActiveUntil,
          suppressDuringSession: notificationPreferences.suppressDuringSession,
        });

      return NextResponse.json({
        sessionActiveUntil: row?.sessionActiveUntil?.toISOString() ?? null,
        suppressDuringSession: row?.suppressDuringSession ?? false,
      });
    }

    // Clearing is unconditional — a client ending a sit releases the hold whatever
    // the preference now says. Skipped when the row is already clear: clients post
    // `active: false` on every session-view unmount, including views that never
    // reported an active sit.
    if (prefs.sessionActiveUntil !== null) {
      await db
        .update(notificationPreferences)
        .set({ sessionActiveUntil: null })
        .where(eq(notificationPreferences.userId, auth.user.userId));
    }

    return NextResponse.json({
      sessionActiveUntil: null,
      suppressDuringSession: prefs.suppressDuringSession,
    });
  },
);
