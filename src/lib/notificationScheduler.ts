import { and, eq, inArray } from "drizzle-orm";
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
import { getLocalCalendarDate } from "@/lib/notificationTime";
import { sendPushNotificationToUser } from "@/lib/notifications";

export type NotificationSchedulerResult = {
  evaluated: number;
  eligible: number;
  sent: number;
  skipped: Record<string, number>;
  errors: number;
};

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
  const eligibleRows: Array<{ preference: DailyReminderPreferenceRow; streak: number }> = [];

  for (const row of prefs) {
    const preference: DailyReminderPreferenceRow = { ...row };
    const localToday = getLocalCalendarDate(preference.timezone, now);
    const hasCompletedSessionToday = await userCompletedSessionOnDate(preference.userId, localToday);
    const streak = await loadUserStreak(preference.userId);

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

async function userCompletedSessionOnDate(userId: string, sessionDate: string): Promise<boolean> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.sessionDate, sessionDate),
        eq(sessions.completed, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function loadUserStreak(userId: string): Promise<number> {
  const rows = await db
    .select({
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
    .where(eq(sessions.userId, userId));

  const inputs: SessionStatsInput[] = rows.map((row) => ({
    sessionType: row.sessionType,
    dayNumber: row.dayNumber,
    duration: row.duration,
    bonusSeconds: row.bonusSeconds,
    completed: row.completed,
    clearPercent: row.clearPercent,
    thoughtCount: row.thoughtCount,
    sessionDate: row.sessionDate,
    createdAt: row.createdAt,
  }));

  return streakFromSessions(inputs);
}

export async function dispatchDailyReminderForUser(params: {
  userId: string;
  streak: number;
}): Promise<boolean> {
  const payload = buildDailyReminderPayload(params.streak);
  const now = new Date();

  const claimed = await poolDb.transaction(async (tx) => {
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

    await tx
      .update(notificationPreferences)
      .set({
        lastDailyReminderSentAt: now,
        updatedAt: now,
      })
      .where(eq(notificationPreferences.userId, params.userId));

    return true;
  });

  if (!claimed) return false;

  await sendPushNotificationToUser({
    recipientUserId: params.userId,
    payload,
  });

  return true;
}

function wasSentToday(sentAt: Date | null, timezone: string, now: Date): boolean {
  if (!sentAt) return false;
  return getLocalCalendarDate(timezone, sentAt) === getLocalCalendarDate(timezone, now);
}

/** Batch helper for tests — not used by cron (per-user transaction is safer). */
export async function dispatchDailyReminders(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const streaks = new Map<string, number>();
  for (const userId of userIds) {
    streaks.set(userId, await loadUserStreak(userId));
  }

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
