/**
 * Session-scoped notification holds (#741).
 *
 * Each live sit has its own row. Releasing one sit deletes only that row, then
 * `notification_preferences.session_active_until` is rewritten to the latest
 * remaining unexpired expiry (or null). Read paths keep consulting that column.
 *
 * The Neon HTTP driver has no interactive transaction, so the hold write and
 * the column update run as two statements. A crash between them leaves a
 * TTL-bounded column, which is the same failure the legacy single-column hold
 * already had.
 */

import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences, sessionNotificationHolds } from "@/db/schema";
import { sessionActiveUntilFrom } from "@/lib/notifications/session-active";

export const SESSION_KEY_MAX_LENGTH = 64;

export function isSessionKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= SESSION_KEY_MAX_LENGTH;
}

export async function upsertSessionHold(
  userId: string,
  sessionKey: string,
  now: Date = new Date(),
): Promise<Date> {
  const expiresAt = sessionActiveUntilFrom(now);
  await db
    .insert(sessionNotificationHolds)
    .values({ userId, sessionKey, expiresAt })
    .onConflictDoUpdate({
      target: [sessionNotificationHolds.userId, sessionNotificationHolds.sessionKey],
      set: { expiresAt, updatedAt: now },
    });
  return expiresAt;
}

export async function releaseSessionHold(userId: string, sessionKey: string): Promise<void> {
  await db
    .delete(sessionNotificationHolds)
    .where(and(
      eq(sessionNotificationHolds.userId, userId),
      eq(sessionNotificationHolds.sessionKey, sessionKey),
    ));
}

/** Latest unexpired hold for this user, or null when every row has lapsed. */
export async function maxUnexpiredHoldExpiry(
  userId: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const rows = await db
    .select({ expiresAt: sessionNotificationHolds.expiresAt })
    .from(sessionNotificationHolds)
    .where(and(
      eq(sessionNotificationHolds.userId, userId),
      gt(sessionNotificationHolds.expiresAt, now),
    ))
    .orderBy(desc(sessionNotificationHolds.expiresAt))
    .limit(1);
  return rows[0]?.expiresAt ?? null;
}

async function writeDerivedSessionActiveUntil(
  userId: string,
  sessionActiveUntil: Date | null,
): Promise<void> {
  await db
    .update(notificationPreferences)
    .set({ sessionActiveUntil })
    .where(eq(notificationPreferences.userId, userId));
}

export async function applyKeyedSessionState(input: {
  userId: string;
  sessionKey: string;
  active: boolean;
  suppressDuringSession: boolean;
  now?: Date;
}): Promise<{ sessionActiveUntil: string | null; suppressDuringSession: boolean }> {
  const now = input.now ?? new Date();

  if (input.active) {
    if (!input.suppressDuringSession) {
      return { sessionActiveUntil: null, suppressDuringSession: false };
    }
    // Insert the row first so a concurrent release on another sit can see it
    // when it recomputes the derived column. If the preference was turned off
    // before the column write, drop the row we just took.
    const expiresAt = await upsertSessionHold(input.userId, input.sessionKey, now);
    const [row] = await db
      .update(notificationPreferences)
      .set({ sessionActiveUntil: expiresAt })
      .where(and(
        eq(notificationPreferences.userId, input.userId),
        eq(notificationPreferences.suppressDuringSession, true),
      ))
      .returning({
        sessionActiveUntil: notificationPreferences.sessionActiveUntil,
        suppressDuringSession: notificationPreferences.suppressDuringSession,
      });
    if (!row) {
      await releaseSessionHold(input.userId, input.sessionKey);
      return { sessionActiveUntil: null, suppressDuringSession: false };
    }
    return {
      sessionActiveUntil: row.sessionActiveUntil?.toISOString() ?? null,
      suppressDuringSession: row.suppressDuringSession,
    };
  }

  await releaseSessionHold(input.userId, input.sessionKey);
  const remaining = await maxUnexpiredHoldExpiry(input.userId, now);
  await writeDerivedSessionActiveUntil(input.userId, remaining);
  return {
    sessionActiveUntil: remaining?.toISOString() ?? null,
    suppressDuringSession: input.suppressDuringSession,
  };
}
