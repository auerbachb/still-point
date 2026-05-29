import { sendPushNotificationToUser } from "@/lib/notifications";
import { recordDispatch } from "@/lib/notifications/dispatch";
import { userCompletedSessionOnDate, userStandardStreakEndingOnDate } from "@/lib/notifications/meditation";
import {
  addCalendarDays,
  frequencyAllowsSendToday,
  isInQuietHours,
  isReminderDueNow,
  localCalendarDate,
} from "@/lib/notifications/time";
import type { NotificationTickCandidate } from "@/lib/notifications/types";

export const DAILY_REMINDER_DEEP_LINK = "stillpoint://session";

export type DailyReminderEligibility =
  | { eligible: true; localDate: string; title: string; body: string }
  | { eligible: false; reason: string };

export async function evaluateDailyReminderEligibility(
  prefs: NotificationTickCandidate,
  now: Date = new Date(),
): Promise<DailyReminderEligibility> {
  if (!prefs.pushEnabled) return { eligible: false, reason: "push_disabled" };
  if (!prefs.dailyReminderEnabled) return { eligible: false, reason: "daily_reminder_disabled" };
  if (!frequencyAllowsSendToday({ frequency: prefs.frequency, now, timeZone: prefs.timezone })) {
    return { eligible: false, reason: "frequency_skip" };
  }
  if (!isReminderDueNow({ now, timeZone: prefs.timezone, reminderTime: prefs.reminderTime })) {
    return { eligible: false, reason: "not_reminder_time" };
  }
  if (isInQuietHours({
    now,
    timeZone: prefs.timezone,
    quietHoursStart: prefs.quietHoursStart,
    quietHoursEnd: prefs.quietHoursEnd,
  })) {
    return { eligible: false, reason: "quiet_hours" };
  }

  const localDate = localCalendarDate(now, prefs.timezone);
  if (await userCompletedSessionOnDate({ userId: prefs.userId, localDate })) {
    return { eligible: false, reason: "meditated_today" };
  }

  const yesterday = addCalendarDays(localDate, -1);
  const streak = await userStandardStreakEndingOnDate({
    userId: prefs.userId,
    endDate: yesterday,
  });

  if (streak > 3) {
    return {
      eligible: true,
      localDate,
      title: "Still Point",
      body: `Day ${streak} of your streak — keep it going.`,
    };
  }

  return {
    eligible: true,
    localDate,
    title: "Still Point",
    body: "Ready when you are. Tap to begin your daily sit.",
  };
}

export async function sendDailyReminderNotification(params: {
  userId: string;
  localDate: string;
  title: string;
  body: string;
}): Promise<boolean> {
  const { delivered } = await sendPushNotificationToUser({
    recipientUserId: params.userId,
    payload: {
      aps: {
        alert: {
          title: params.title,
          body: params.body,
        },
        sound: "default",
        "thread-id": "meditation-reminders",
      },
      type: "daily_reminder",
      deepLink: DAILY_REMINDER_DEEP_LINK,
    },
  });
  if (!delivered) return false;

  return recordDispatch({
    userId: params.userId,
    localDate: params.localDate,
    notificationType: "daily_reminder",
  });
}
