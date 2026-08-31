import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { getOrCreateNotificationPreferences } from "@/lib/notification-preferences";
import { sessionActiveUntilFrom } from "@/lib/notifications/session-active";
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

    const { active } = json.body;
    if (typeof active !== "boolean") {
      return NextResponse.json({ error: "active must be a boolean" }, { status: 400 });
    }

    const prefs = await getOrCreateNotificationPreferences(auth.user.userId);
    const sessionActiveUntil = active && prefs.suppressDuringSession ? sessionActiveUntilFrom() : null;

    // Skip the write when clearing state that is already clear — clients post
    // `active: false` on every session-view unmount, including views that never
    // reported an active sit.
    if (sessionActiveUntil !== null || prefs.sessionActiveUntil !== null) {
      // `updatedAt` is deliberately untouched: a heartbeat is not a preference
      // edit, and bumping it every 60s would churn the row clients sync on.
      await db
        .update(notificationPreferences)
        .set({ sessionActiveUntil })
        .where(eq(notificationPreferences.userId, auth.user.userId));
    }

    return NextResponse.json({
      sessionActiveUntil: sessionActiveUntil?.toISOString() ?? null,
      suppressDuringSession: prefs.suppressDuringSession,
    });
  },
);
