import { sendPushNotificationToUser } from "@/lib/notifications";
import { recordDispatch } from "@/lib/notifications/dispatch";
import { userCompletedSessionOnDate } from "@/lib/notifications/meditation";
import {
  addCalendarDays,
  isInQuietHours,
  isReminderDueNow,
  localCalendarDate,
} from "@/lib/notifications/time";
import type { NotificationTickCandidate } from "@/lib/notifications/types";

export const MISS_A_DAY_DEEP_LINK = "stillpoint://session/quick";

export const missADayNotificationCopy = {
  title: "Still Point",
  body: "Missed yesterday — try a quick 1-min sit to get back.",
} as const;

export type MissADayEligibility =
  | { eligible: true; localDate: string; yesterday: string }
  | { eligible: false; reason: string };

export async function evaluateMissADayEligibility(
  prefs: NotificationTickCandidate,
  now: Date = new Date(),
): Promise<MissADayEligibility> {
  if (!prefs.pushEnabled) return { eligible: false, reason: "push_disabled" };
  if (!prefs.missADayEnabled) return { eligible: false, reason: "miss_a_day_disabled" };
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
  const yesterday = addCalendarDays(localDate, -1);

  if (await userCompletedSessionOnDate({ userId: prefs.userId, localDate })) {
    return { eligible: false, reason: "meditated_today" };
  }
  if (await userCompletedSessionOnDate({ userId: prefs.userId, localDate: yesterday })) {
    return { eligible: false, reason: "completed_yesterday" };
  }

  return { eligible: true, localDate, yesterday };
}

export async function sendMissADayNotification(params: {
  userId: string;
  localDate: string;
}): Promise<boolean> {
  const { delivered } = await sendPushNotificationToUser({
    recipientUserId: params.userId,
    payload: {
      aps: {
        alert: {
          title: missADayNotificationCopy.title,
          body: missADayNotificationCopy.body,
        },
        sound: "default",
        "thread-id": "meditation-reminders",
      },
      type: "miss_a_day",
      deepLink: MISS_A_DAY_DEEP_LINK,
    },
  });
  if (!delivered) return false;

  return recordDispatch({
    userId: params.userId,
    localDate: params.localDate,
    notificationType: "miss_a_day",
  });
}
