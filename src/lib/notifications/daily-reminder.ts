import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { notificationDispatches, sessions } from "@/db/schema";
import type { ApnsPayload } from "@/lib/apns";
import { calculateSessionStats, type SessionStatsInput } from "@/lib/constants";
import { addDaysToIsoDate } from "@/lib/sessionCalendar";

const DAILY_REMINDER_NOTIFICATION_TYPE = "daily_reminder";
export const MISS_A_DAY_NOTIFICATION_TYPE = "miss_a_day";
const DAILY_REMINDER_DEEP_LINK = "stillpoint://home";

const STREAK_LOOKBACK_DAYS = 90;

export type DailyReminderWebPushPayload = {
  title: string;
  body: string;
  type: typeof DAILY_REMINDER_NOTIFICATION_TYPE;
  url: string;
};

export function buildDailyReminderWebPushPayload(streak: number): DailyReminderWebPushPayload {
  const apns = buildDailyReminderPayload(streak);
  const alert = apns.aps?.alert;
  const title = typeof alert === "object" && alert !== null && "title" in alert
    ? String(alert.title)
    : "Still Point";
  const body = typeof alert === "object" && alert !== null && "body" in alert
    ? String(alert.body)
    : "";
  return {
    title,
    body,
    type: DAILY_REMINDER_NOTIFICATION_TYPE,
    url: "/app",
  };
}

export function buildDailyReminderPayload(streak: number): ApnsPayload {
  const body = streak > 3
    ? `Day ${streak} of your streak — keep it going.`
    : "Time for a moment of stillness. Tap to begin.";

  return {
    aps: {
      alert: {
        title: "Still Point",
        body,
      },
      sound: "default",
      "thread-id": "daily-reminder",
    },
    type: DAILY_REMINDER_NOTIFICATION_TYPE,
    deepLink: DAILY_REMINDER_DEEP_LINK,
  };
}

export function streakFromSessions(sessionRows: SessionStatsInput[]): number {
  return calculateSessionStats(sessionRows).streak;
}

export async function loadUserStreak(
  userId: string,
  anchorLocalDateKey: string,
): Promise<number> {
  const minSessionDate = addDaysToIsoDate(anchorLocalDateKey, -STREAK_LOOKBACK_DAYS);

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
    .where(
      and(
        eq(sessions.userId, userId),
        gte(sessions.sessionDate, minSessionDate),
      ),
    );

  return streakFromSessions(rows);
}

export async function userCompletedSessionOnDate(
  userId: string,
  sessionDate: string,
): Promise<boolean> {
  const [row] = await db
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

  return !!row;
}

/** De-dup with miss-a-day (#247): skip daily reminder if miss-a-day already sent for this local date. */
export async function hasMissADayDispatchForDate(
  userId: string,
  localDateKey: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: notificationDispatches.id })
    .from(notificationDispatches)
    .where(
      and(
        eq(notificationDispatches.userId, userId),
        eq(notificationDispatches.notificationType, MISS_A_DAY_NOTIFICATION_TYPE),
        eq(notificationDispatches.windowKey, localDateKey),
      ),
    )
    .limit(1);

  return !!row;
}
