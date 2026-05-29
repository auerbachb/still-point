import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { poolDb } from "@/db/pool";
import { notificationPreferences, sessions } from "@/db/schema";
import type { SessionStatsInput } from "@/lib/constants";
import {
  buildDailyReminderPayload,
  evaluateDailyReminderEligibility,
  SCHEDULER_TICK_MINUTES,
  streakFromSessions,
  type DailyReminderPreferenceRow,
} from "@/lib/notifications/daily-reminder";
import { addDaysToIsoDate } from "@/lib/sessionCalendar";
import { getLocalCalendarDate } from "@/lib/notificationTime";
import { sendPushNotificationToUser } from "@/lib/notifications";

export type NotificationSchedulerResult = {
  evaluated: number;
  eligible: number;
  sent: number;
  skipped: Record<string, number>;
  errors: number;
};

const STREAK_LOOKBACK_DAYS = 90;

export async function runNotificationScheduler(
  now: Date = new Date(),
  tickMinutes: number = SCHEDULER_TICK_MINUTES,
): Promise<NotificationSchedulerResult> {
  const prefs = await db
    .select({
      userId: notificationPreferences.userId,
      enabled: notificationPreferences.enabled,
      dailyReminderEnabled: notificationPreferences.dailyReminderEnabled,
      preferredTime: notificationPreferences.preferredTime,
      frequency: notificationPreferences.frequency,
      quietHoursStart: notificationPreferences.quietHoursStart,
      quietHoursEnd: notificationPreferences.quietHoursEnd,
      timezone: notificationPreferences.timezone,
      lastDailyReminderSentAt: notificationPreferences.lastDailyReminderSentAt,
      lastMissADaySentAt: notificationPreferences.lastMissADaySentAt,
      createdAt: notificationPreferences.createdAt,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.enabled, true),
        eq(notificationPreferences.dailyReminderEnabled, true),
      ),
    );

  const skipped: Record<string, number> = {};
  const preflightPassed: DailyReminderPreferenceRow[] = [];

  for (const row of prefs) {
    const preference: DailyReminderPreferenceRow = { ...row };
    const result = evaluateDailyReminderEligibility({
      preference,
      hasCompletedSessionToday: false,
      streak: 0,
      now,
      tickMinutes,
      preflightOnly: true,
    });

    if (!result.eligible) {
      skipped[result.reason] = (skipped[result.reason] ?? 0) + 1;
      continue;
    }

    preflightPassed.push(preference);
  }

  const completedToday = await loadUsersWithCompletedSessionToday(
    preflightPassed.map((p) => ({
      userId: p.userId,
      sessionDate: getLocalCalendarDate(p.timezone, now),
    })),
  );

  const streaks = await loadStreaksForUsers(preflightPassed.map((p) => p.userId), now);

  const eligibleRows: Array<{ preference: DailyReminderPreferenceRow; streak: number }> = [];

  for (const preference of preflightPassed) {
    const localToday = getLocalCalendarDate(preference.timezone, now);
    const hasCompletedSessionToday = completedToday.has(`${preference.userId}:${localToday}`);
    const streak = streaks.get(preference.userId) ?? 0;

    const result = evaluateDailyReminderEligibility({
      preference,
      hasCompletedSessionToday,
      streak,
      now,
      tickMinutes,
    });

    if (!result.eligible) {
      skipped[result.reason] = (skipped[result.reason] ?? 0) + 1;
      continue;
    }

    eligibleRows.push({ preference, streak });
  }

  let sent = 0;
  let errors = 0;

  for (const { preference, streak } of eligibleRows) {
    try {
      const dispatched = await dispatchDailyReminderForUser({
        userId: preference.userId,
        streak,
      });
      if (dispatched) sent += 1;
    } catch (error) {
      errors += 1;
      console.error("Daily reminder dispatch failed", {
        userId: preference.userId,
        error,
      });
    }
  }

  return {
    evaluated: prefs.length,
    eligible: eligibleRows.length,
    sent,
    skipped,
    errors,
  };
}

async function loadUsersWithCompletedSessionToday(
  pairs: Array<{ userId: string; sessionDate: string }>,
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();

  const rows = await db
    .select({
      userId: sessions.userId,
      sessionDate: sessions.sessionDate,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.completed, true),
        or(
          ...pairs.map((pair) =>
            and(eq(sessions.userId, pair.userId), eq(sessions.sessionDate, pair.sessionDate)),
          ),
        ),
      ),
    );

  return new Set(rows.map((row) => `${row.userId}:${row.sessionDate}`));
}

async function loadStreaksForUsers(userIds: string[], now: Date): Promise<Map<string, number>> {
  const streaks = new Map<string, number>();
  if (userIds.length === 0) return streaks;

  const minSessionDate = addDaysToIsoDate(getLocalCalendarDate("UTC", now), -STREAK_LOOKBACK_DAYS);

  const rows = await db
    .select({
      userId: sessions.userId,
      sessionType: sessions.sessionType,
      dayNumber: sessions.dayNumber,
      duration: sessions.duration,
      bonusSeconds: sessions.bonusSeconds,
      completed: sessions.completed,
      clearPercent: sessions.clearPercent,
      thoughtCount: sessions.thoughtCount,
      sessionDate: sessions.sessionDate,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(
        inArray(sessions.userId, userIds),
        gte(sessions.sessionDate, minSessionDate),
      ),
    );

  const byUser = new Map<string, SessionStatsInput[]>();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push({
      sessionType: row.sessionType,
      dayNumber: row.dayNumber,
      duration: row.duration,
      bonusSeconds: row.bonusSeconds,
      completed: row.completed,
      clearPercent: row.clearPercent,
      thoughtCount: row.thoughtCount,
      sessionDate: row.sessionDate,
      createdAt: row.createdAt,
    });
    byUser.set(row.userId, list);
  }

  for (const userId of userIds) {
    streaks.set(userId, streakFromSessions(byUser.get(userId) ?? []));
  }

  return streaks;
}

export async function dispatchDailyReminderForUser(params: {
  userId: string;
  streak: number;
}): Promise<boolean> {
  const payload = buildDailyReminderPayload(params.streak);
  const now = new Date();
  const lockKey = `daily-reminder:${params.userId}`;

  return poolDb.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`,
    );

    const [locked] = await tx
      .select({
        lastDailyReminderSentAt: notificationPreferences.lastDailyReminderSentAt,
        timezone: notificationPreferences.timezone,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, params.userId))
      .limit(1);

    if (!locked) return false;

    if (wasSentToday(locked.lastDailyReminderSentAt, locked.timezone, now)) {
      return false;
    }

    await sendPushNotificationToUser({
      recipientUserId: params.userId,
      payload,
    });

    await tx
      .update(notificationPreferences)
      .set({
        lastDailyReminderSentAt: now,
        updatedAt: now,
      })
      .where(eq(notificationPreferences.userId, params.userId));

    return true;
  });
}

function wasSentToday(sentAt: Date | null, timezone: string, now: Date): boolean {
  if (!sentAt) return false;
  return getLocalCalendarDate(timezone, sentAt) === getLocalCalendarDate(timezone, now);
}

/** Batch helper for tests — not used by cron (per-user transaction is safer). */
export async function dispatchDailyReminders(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const streaks = await loadStreaksForUsers(userIds, new Date());

  let sent = 0;
  for (const userId of userIds) {
    if (await dispatchDailyReminderForUser({ userId, streak: streaks.get(userId) ?? 0 })) {
      sent += 1;
    }
  }
  return sent;
}

export async function markMissADaySent(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const now = new Date();
  await db
    .update(notificationPreferences)
    .set({ lastMissADaySentAt: now, updatedAt: now })
    .where(inArray(notificationPreferences.userId, userIds));
}
