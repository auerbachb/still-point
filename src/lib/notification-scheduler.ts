import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { notificationDispatches, notificationPreferences } from "@/db/schema";
import type { DailyReminderFrequency } from "@/lib/notification-preferences";
import {
  hasMissADayDispatchForDate,
  loadUserStreak,
  userCompletedSessionOnDate,
} from "@/lib/notifications/daily-reminder";
import {
  FAILURE_REASON_NOTIFICATION_TYPE,
  FAILURE_REASON_REMINDER_MINUTES,
  hasFailureReasonForDate,
} from "@/lib/notifications/failure-reason";
import {
  sendDailyReminderNotification,
  sendFailureReasonReminderNotification,
  sendMissADayNotification,
} from "@/lib/notifications";

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

/**
 * Returns whether the current cron run covers a due reminder, and the calendar-day
 * offset of the reminder's *intended* date relative to the run's local date.
 *
 * dayOffset is 0 when the reminder was due today, -1 when the run crossed midnight
 * and is catching a reminder that was due yesterday (e.g. a 23:55 reminder covered
 * by the 00:00 run). Callers must use `addCalendarDays(local.dateKey, dayOffset)` as
 * the dispatch windowKey so that the existing claimNotificationDispatch idempotency
 * anchors each send to the reminder's *intended* date rather than the run's date.
 *
 * Without the dayOffset correction a 23:55 reminder could be sent twice in five minutes:
 * - 23:55 run: delta=0, windowKey="2026-05-29" → claims and sends ✓
 * - 00:00 run: delta=5 (still within window), windowKey="2026-05-30" → new key, sends again ✗
 */
function isWithinCronWindow(
  localMinutes: number,
  reminderMinutes: number,
): { within: boolean; dayOffset: 0 | -1 } {
  const dayMinutes = 24 * 60;
  const delta = (localMinutes - reminderMinutes + dayMinutes) % dayMinutes;
  // Inclusive upper bound: the cron runs every CRON_WINDOW_MINUTES, but Vercel cron
  // invocations can drift by up to a minute. With an exclusive bound a reminder whose
  // only covering run landed exactly CRON_WINDOW_MINUTES late (delta === window) was
  // dropped, leaving enabled users with no notification for days. The 1-minute overlap
  // between adjacent runs is de-duplicated by claimNotificationDispatch — but only when
  // both runs use the same windowKey (see dayOffset below).
  if (delta > CRON_WINDOW_MINUTES) {
    return { within: false, dayOffset: 0 };
  }
  // When localMinutes < reminderMinutes the modular arithmetic wrapped: the run is just
  // past midnight and the reminder was due on the *previous* calendar day.
  const dayOffset: 0 | -1 = delta > 0 && localMinutes < reminderMinutes ? -1 : 0;
  return { within: true, dayOffset };
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
  intendedDateKey: string,
): boolean {
  if (frequency === "daily") {
    return true;
  }
  if (frequency === "every_other") {
    // Use the reminder's intended date, not the run's local date. A cross-midnight run
    // (e.g. 00:00 covering a 23:55 reminder) must evaluate parity on the intended day
    // or the send is incorrectly skipped.
    const anchor = new Date(`${intendedDateKey}T00:00:00.000Z`).getTime();
    const days = Math.floor(anchor / 86_400_000);
    return days % 2 === 0;
  }
  // weekly: reminder is due on Monday (dayIndex 1). Derive the day-of-week from the
  // intended date so a cross-midnight run doesn't apply Tuesday's index to a Monday
  // reminder.
  const [y, m, d] = intendedDateKey.split("-").map(Number);
  const intendedDayIndex = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return intendedDayIndex === 1;
}

function windowKeyForFrequency(
  frequency: DailyReminderFrequency,
  local: LocalParts,
  intendedDateKey: string,
): string {
  if (frequency === "weekly") {
    // For weekly cadence use the ISO week of the intended date, not the run date.
    const { isoYear, week } = isoWeekPartsFromDateKey(intendedDateKey);
    return `${isoYear}-W${week}`;
  }
  return intendedDateKey;
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

async function releaseMissADayClaim(userId: string, windowKey: string): Promise<void> {
  await db
    .delete(notificationDispatches)
    .where(
      and(
        eq(notificationDispatches.userId, userId),
        eq(notificationDispatches.notificationType, "miss_a_day"),
        eq(notificationDispatches.windowKey, windowKey),
      ),
    );
}

async function releaseFailureReasonClaim(userId: string, windowKey: string): Promise<void> {
  await db
    .delete(notificationDispatches)
    .where(
      and(
        eq(notificationDispatches.userId, userId),
        eq(notificationDispatches.notificationType, FAILURE_REASON_NOTIFICATION_TYPE),
        eq(notificationDispatches.windowKey, windowKey),
      ),
    );
}

/**
 * Failure-reason reminder (#441): fixed 8 PM local nudge to log why the user could
 * not meditate. Yesterday's missed day takes priority over today, so the morning-after
 * "you missed yesterday" framing wins when both are open.
 *
 * Idempotency is anchored to `triggerDate` (the local date the 8 PM run fires on), NOT
 * the day being asked about. A day the user never logs is therefore surfaced twice — once
 * that evening ("today" framing) and once the next evening ("yesterday" framing) — which
 * is the behavior the ticket asks for, while still capping sends to one per user per day.
 * Returns "sent" only when a push was actually delivered on some channel.
 */
async function dispatchFailureReasonReminder(
  userId: string,
  triggerDate: string,
): Promise<"sent" | "skipped"> {
  const yesterday = addCalendarDays(triggerDate, -1);

  let targetDate: string | null = null;
  let isYesterday = false;

  const satYesterday = await userCompletedSessionOnDate(userId, yesterday);
  const loggedYesterday = satYesterday || (await hasFailureReasonForDate(userId, yesterday));
  if (!loggedYesterday) {
    targetDate = yesterday;
    isYesterday = true;
  } else {
    const satToday = await userCompletedSessionOnDate(userId, triggerDate);
    const loggedToday = satToday || (await hasFailureReasonForDate(userId, triggerDate));
    if (!loggedToday) {
      targetDate = triggerDate;
      isYesterday = false;
    }
  }

  if (!targetDate) {
    return "skipped";
  }

  const claimed = await claimNotificationDispatch({
    userId,
    notificationType: FAILURE_REASON_NOTIFICATION_TYPE,
    windowKey: triggerDate,
  });
  if (!claimed) {
    return "skipped";
  }

  try {
    const { delivered } = await sendFailureReasonReminderNotification({
      recipientUserId: userId,
      targetDate,
      isYesterday,
    });
    if (delivered) {
      return "sent";
    }
    await releaseFailureReasonClaim(userId, triggerDate);
    return "skipped";
  } catch (sendError) {
    // Release the claim so a later run can retry rather than permanently blocking this date.
    console.error(`Failed to send failure-reason reminder to user ${userId}:`, sendError);
    await releaseFailureReasonClaim(userId, triggerDate);
    return "skipped";
  }
}

function addCalendarDays(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return utc.toISOString().slice(0, 10);
}

export async function dispatchDueNotifications(now: Date = new Date()): Promise<{
  scanned: number;
  sent: number;
  skipped: number;
  missADaySent: number;
  failureReasonSent: number;
}> {
  const candidates = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.pushEnabled, true),
        or(
          eq(notificationPreferences.dailyReminderEnabled, true),
          eq(notificationPreferences.missADayEnabled, true),
          eq(notificationPreferences.failureReasonReminderEnabled, true),
        ),
      ),
    );

  let sent = 0;
  let skipped = 0;
  let missADaySent = 0;
  let failureReasonSent = 0;

  for (const prefs of candidates) {
    try {
      const local = getLocalParts(now, prefs.tz);

      // Failure-reason reminder fires at a fixed 8 PM local time, independent of the
      // user's daily reminder time. Handle it first, then fall through only when daily /
      // miss-a-day are also enabled (their gates below `continue` out of this iteration
      // when their own window — the daily reminder time — does not match this run).
      let sentForCandidate = false;
      if (prefs.failureReasonReminderEnabled) {
        const frWindow = isWithinCronWindow(local.minutesSinceMidnight, FAILURE_REASON_REMINDER_MINUTES);
        if (
          frWindow.within &&
          !isInQuietHours(local.minutesSinceMidnight, prefs.quietHoursStart, prefs.quietHoursEnd)
        ) {
          const triggerDate = addCalendarDays(local.dateKey, frWindow.dayOffset);
          const outcome = await dispatchFailureReasonReminder(prefs.userId, triggerDate);
          if (outcome === "sent") {
            failureReasonSent += 1;
            sent += 1;
            sentForCandidate = true;
          }
        }
      }

      // A failure-reason-only candidate has no further work; don't let it fall through
      // into the daily flow where it would be double-counted as skipped.
      if (!prefs.dailyReminderEnabled && !prefs.missADayEnabled) {
        if (!sentForCandidate) {
          skipped += 1;
        }
        continue;
      }

      const reminderMinutes = parseReminderMinutes(prefs.dailyReminderTime);

      const { within, dayOffset } = isWithinCronWindow(local.minutesSinceMidnight, reminderMinutes);
      if (!within) {
        skipped += 1;
        continue;
      }

      // intendedDateKey is the calendar date the reminder was *due* — today for normal runs,
      // yesterday when the cron just crossed midnight catching a late-evening reminder.
      // Using it as the dispatch windowKey anchors deduplication to the reminder's intended
      // date rather than the run's date, preventing duplicate sends at midnight boundaries.
      const intendedDateKey = addCalendarDays(local.dateKey, dayOffset);

      if (isInQuietHours(local.minutesSinceMidnight, prefs.quietHoursStart, prefs.quietHoursEnd)) {
        skipped += 1;
        continue;
      }

      if (prefs.missADayEnabled) {
        const yesterday = addCalendarDays(intendedDateKey, -1);
        const meditatedToday = await userCompletedSessionOnDate(prefs.userId, intendedDateKey);
        const completedYesterday = await userCompletedSessionOnDate(prefs.userId, yesterday);

        if (!meditatedToday && !completedYesterday) {
          const claimed = await claimNotificationDispatch({
            userId: prefs.userId,
            notificationType: "miss_a_day",
            windowKey: intendedDateKey,
          });

          if (claimed) {
            try {
              const { delivered } = await sendMissADayNotification({ recipientUserId: prefs.userId });
              if (delivered) {
                missADaySent += 1;
                sent += 1;
                continue;
              }
              await releaseMissADayClaim(prefs.userId, intendedDateKey);
            } catch (sendError) {
              // Without this catch, a thrown send would leave the claim row in place,
              // permanently blocking both miss_a_day and (via hasMissADayDispatchForDate)
              // the daily reminder for this user/date. Release the claim so the next run retries.
              console.error("Failed to send miss-a-day notification:", sendError);
              await releaseMissADayClaim(prefs.userId, intendedDateKey);
            }
          }
        }
      }

      if (!prefs.dailyReminderEnabled) {
        skipped += 1;
        continue;
      }

      const frequency = prefs.dailyReminderFrequency as DailyReminderFrequency;
      if (!frequencyAllowsSend(frequency, intendedDateKey)) {
        skipped += 1;
        continue;
      }

      if (await userCompletedSessionOnDate(prefs.userId, intendedDateKey)) {
        skipped += 1;
        continue;
      }

      if (await hasMissADayDispatchForDate(prefs.userId, intendedDateKey)) {
        skipped += 1;
        continue;
      }

      const windowKey = windowKeyForFrequency(frequency, local, intendedDateKey);
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
        const streak = await loadUserStreak(prefs.userId, intendedDateKey);
        const { delivered } = await sendDailyReminderNotification({ recipientUserId: prefs.userId, streak });
        if (delivered) {
          sent += 1;
        } else {
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

  return { scanned: candidates.length, sent, skipped, missADaySent, failureReasonSent };
}
