import { and, eq, exists, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { deviceTokens, notificationPreferences, users } from "@/db/schema";
import { hasDispatchedToday } from "@/lib/notifications/dispatch";
import {
  evaluateDailyReminderEligibility,
  sendDailyReminderNotification,
} from "@/lib/notifications/daily-reminder";
import {
  evaluateMissADayEligibility,
  sendMissADayNotification,
} from "@/lib/notifications/miss-a-day";
import { localCalendarDate } from "@/lib/notifications/time";
import type { NotificationTickCandidate } from "@/lib/notifications/types";

export type NotificationSchedulerResult = {
  scanned: number;
  missADaySent: number;
  dailyReminderSent: number;
  skipped: number;
  errors: number;
};

export async function runNotificationScheduler(now: Date = new Date()): Promise<NotificationSchedulerResult> {
  const candidates = await loadSchedulerCandidates();
  const result: NotificationSchedulerResult = {
    scanned: candidates.length,
    missADaySent: 0,
    dailyReminderSent: 0,
    skipped: 0,
    errors: 0,
  };

  for (const prefs of candidates) {
    try {
      const localDate = localCalendarDate(now, prefs.timezone);
      if (await hasDispatchedToday({ userId: prefs.userId, localDate })) {
        result.skipped += 1;
        continue;
      }

      const missADay = await evaluateMissADayEligibility(prefs, now);
      if (missADay.eligible) {
        const sent = await sendMissADayNotification({
          userId: prefs.userId,
          localDate: missADay.localDate,
        });
        if (sent) result.missADaySent += 1;
        else result.skipped += 1;
        continue;
      }

      const daily = await evaluateDailyReminderEligibility(prefs, now);
      if (daily.eligible) {
        const sent = await sendDailyReminderNotification({
          userId: prefs.userId,
          localDate: daily.localDate,
          title: daily.title,
          body: daily.body,
        });
        if (sent) result.dailyReminderSent += 1;
        else result.skipped += 1;
        continue;
      }

      result.skipped += 1;
    } catch (error) {
      result.errors += 1;
      console.error("Notification scheduler candidate failed", {
        userId: prefs.userId,
        error,
      });
    }
  }

  return result;
}

async function loadSchedulerCandidates(): Promise<NotificationTickCandidate[]> {
  const rows = await db
    .select({
      userId: notificationPreferences.userId,
      pushEnabled: notificationPreferences.pushEnabled,
      timezone: notificationPreferences.timezone,
      reminderTime: notificationPreferences.reminderTime,
      frequency: notificationPreferences.frequency,
      quietHoursStart: notificationPreferences.quietHoursStart,
      quietHoursEnd: notificationPreferences.quietHoursEnd,
      dailyReminderEnabled: notificationPreferences.dailyReminderEnabled,
      missADayEnabled: notificationPreferences.missADayEnabled,
      currentDay: users.currentDay,
    })
    .from(notificationPreferences)
    .innerJoin(users, eq(users.id, notificationPreferences.userId))
    .where(
      and(
        eq(notificationPreferences.pushEnabled, true),
        exists(
          db
            .select({ id: deviceTokens.id })
            .from(deviceTokens)
            .where(
              and(
                eq(deviceTokens.userId, notificationPreferences.userId),
                eq(deviceTokens.enabled, true),
              ),
            ),
        ),
        or(
          eq(notificationPreferences.dailyReminderEnabled, true),
          eq(notificationPreferences.missADayEnabled, true),
        ),
      ),
    );

  return rows.map((row) => ({
    ...row,
    frequency: row.frequency as NotificationTickCandidate["frequency"],
  }));
}

/** Exported for tests — narrow users who would be scanned this tick. */
export async function listPushEnabledUserIdsWithDeviceTokens(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ userId: deviceTokens.userId })
    .from(deviceTokens)
    .where(and(inArray(deviceTokens.userId, userIds), eq(deviceTokens.enabled, true)));
  return [...new Set(rows.map((r) => r.userId))];
}
