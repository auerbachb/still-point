import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationDispatches, notificationPreferences } from "@/db/schema";
import type { DailyReminderFrequency } from "@/lib/notification-preferences";
import { sendDailyReminderNotification } from "@/lib/notifications";

const CRON_WINDOW_MINUTES = 5;

type LocalParts = {
  dateKey: string;
  weekKey: string;
  hour: number;
  minute: number;
  minutesSinceMidnight: number;
  dayIndex: number;
};

function getLocalParts(date: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "0";

  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const hour = Number(pick("hour")) % 24;
  const minute = Number(pick("minute"));
  const weekday = pick("weekday");

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const dateKey = `${year}-${month}-${day}`;
  const { isoYear, week } = isoWeekPartsFromDateKey(dateKey);
  const weekKey = `${isoYear}-W${week}`;

  return {
    dateKey,
    weekKey,
    hour,
    minute,
    minutesSinceMidnight: hour * 60 + minute,
    dayIndex: weekdayMap[weekday] ?? 0,
  };
}

export function isoWeekPartsFromDateKey(dateKey: string): { isoYear: number; week: string } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return { isoYear, week: String(weekNo).padStart(2, "0") };
}

function parseReminderMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function isWithinCronWindow(localMinutes: number, reminderMinutes: number): boolean {
  const delta = localMinutes - reminderMinutes;
  return delta >= 0 && delta < CRON_WINDOW_MINUTES;
}

function isInQuietHours(
  localMinutes: number,
  quietStart: string | null,
  quietEnd: string | null,
): boolean {
  if (!quietStart || !quietEnd) {
    return false;
  }
  const start = parseReminderMinutes(quietStart);
  const end = parseReminderMinutes(quietEnd);
  if (start === end) {
    return false;
  }
  if (start < end) {
    return localMinutes >= start && localMinutes < end;
  }
  return localMinutes >= start || localMinutes < end;
}

function frequencyAllowsSend(
  frequency: DailyReminderFrequency,
  local: LocalParts,
): boolean {
  if (frequency === "daily") {
    return true;
  }
  if (frequency === "every_other") {
    const anchor = new Date(`${local.dateKey}T00:00:00Z`).getTime();
    const days = Math.floor(anchor / 86_400_000);
    return days % 2 === 0;
  }
  return local.dayIndex === 1;
}

function windowKeyForFrequency(frequency: DailyReminderFrequency, local: LocalParts): string {
  if (frequency === "weekly") {
    return local.weekKey;
  }
  return local.dateKey;
}

export async function claimNotificationDispatch(params: {
  userId: string;
  notificationType: string;
  windowKey: string;
}): Promise<boolean> {
  const inserted = await db
    .insert(notificationDispatches)
    .values({
      userId: params.userId,
      notificationType: params.notificationType,
      windowKey: params.windowKey,
    })
    .onConflictDoNothing()
    .returning({ id: notificationDispatches.id });

  return inserted.length > 0;
}

export async function dispatchDueNotifications(now: Date = new Date()): Promise<{
  scanned: number;
  sent: number;
  skipped: number;
}> {
  const candidates = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.pushEnabled, true),
        eq(notificationPreferences.dailyReminderEnabled, true),
      ),
    );

  let sent = 0;
  let skipped = 0;

  for (const prefs of candidates) {
    try {
      const local = getLocalParts(now, prefs.tz);
      const reminderMinutes = parseReminderMinutes(prefs.dailyReminderTime);

      if (!isWithinCronWindow(local.minutesSinceMidnight, reminderMinutes)) {
        skipped += 1;
        continue;
      }

      if (isInQuietHours(local.minutesSinceMidnight, prefs.quietHoursStart, prefs.quietHoursEnd)) {
        skipped += 1;
        continue;
      }

      const frequency = prefs.dailyReminderFrequency as DailyReminderFrequency;
      if (!frequencyAllowsSend(frequency, local)) {
        skipped += 1;
        continue;
      }

      const windowKey = windowKeyForFrequency(frequency, local);
      const claimed = await claimNotificationDispatch({
        userId: prefs.userId,
        notificationType: "daily_reminder",
        windowKey,
      });

      if (!claimed) {
        skipped += 1;
        continue;
      }

      try {
        await sendDailyReminderNotification({ recipientUserId: prefs.userId });
        sent += 1;
      } catch (sendError) {
        console.error(`Failed to send daily reminder to user ${prefs.userId}:`, sendError);
        await db
          .delete(notificationDispatches)
          .where(
            and(
              eq(notificationDispatches.userId, prefs.userId),
              eq(notificationDispatches.notificationType, "daily_reminder"),
              eq(notificationDispatches.windowKey, windowKey),
            ),
          );
        skipped += 1;
      }
    } catch (error) {
      console.error(`Scheduler error for user ${prefs.userId}:`, error);
      skipped += 1;
    }
  }

  return { scanned: candidates.length, sent, skipped };
}
