/**
 * Server-side "a sit is running" signal (#709).
 *
 * #431 held notifications at *display* time on each client, which cannot cover a
 * push that arrives while the iOS app is backgrounded or while the web service
 * worker is cold-starting — the banner is already on screen by then. The server
 * therefore keeps a short-lived `notification_preferences.session_active_until`
 * timestamp: clients POST `/api/notifications/session-state` when a sit starts,
 * refresh it on a heartbeat, and clear it when the sit ends. Every send path
 * checks it and withholds the push instead.
 *
 * The value is a TTL rather than a boolean so a client that stops reporting
 * (tab killed, app suspended, network drop) self-heals within
 * `SESSION_ACTIVE_TTL_MS` instead of muting the user forever.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";

/**
 * How long a single "session active" report stays valid. Must be comfortably
 * longer than the client heartbeat (60s on web and iOS) so a normal sit never
 * lapses between refreshes, and short enough that a client which dies mid-sit
 * stops muting the user soon after.
 */
export const SESSION_ACTIVE_TTL_MS = 3 * 60 * 1000;

export type SessionActiveFields = {
  suppressDuringSession: boolean;
  sessionActiveUntil: Date | string | null;
};

/** The value to store when a client reports that a sit is running. */
export function sessionActiveUntilFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_ACTIVE_TTL_MS);
}

function toTime(value: Date | string | null): number | null {
  // `== null` also covers a row that predates the column (undefined), which must
  // read as "no active session" rather than an invalid date.
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * True when this user's pushes must be withheld right now.
 *
 * The preference is re-checked here (not just at write time) so turning the
 * "During sessions" toggle off takes effect immediately, even while a stale
 * timestamp from the current sit is still stored.
 */
export function isSessionActive(prefs: SessionActiveFields, now: Date = new Date()): boolean {
  if (!prefs.suppressDuringSession) return false;
  const until = toTime(prefs.sessionActiveUntil);
  return until !== null && until > now.getTime();
}

/**
 * Row-loading variant for send paths that only carry a recipient id. Fails open
 * (returns false) when the user has no preferences row: a missing row means the
 * user never started a sit through a client that reports state.
 */
export async function isUserSessionActive(userId: string, now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .select({
      suppressDuringSession: notificationPreferences.suppressDuringSession,
      sessionActiveUntil: notificationPreferences.sessionActiveUntil,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return false;
  return isSessionActive(row, now);
}
