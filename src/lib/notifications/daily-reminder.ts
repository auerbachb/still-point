import type { ApnsPayload } from "@/lib/apns";
import { calculateSessionStats, type SessionStatsInput } from "@/lib/constants";
import {
  getLocalCalendarDate,
  getLocalWeekday,
  isPreferredTimeDue,
  isWithinQuietHours,
  wasSentOnLocalCalendarDay,
} from "@/lib/notificationTime";
import { daysBetweenIsoDatesInclusive } from "@/lib/sessionCalendar";

export const DAILY_REMINDER_NOTIFICATION_TYPE = "daily_reminder";
export const DAILY_REMINDER_DEEP_LINK = "stillpoint://home";

export const SCHEDULER_TICK_MINUTES = 5;

export type DailyReminderPreferenceRow = {
  userId: string;
  enabled: boolean;
  dailyReminderEnabled: boolean;
  preferredTime: string;
  frequency: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
  lastDailyReminderSentAt: Date | null;
  lastMissADaySentAt: Date | null;
  createdAt: Date;
};

export type DailyReminderEligibilityInput = {
  preference: DailyReminderPreferenceRow;
  hasCompletedSessionToday: boolean;
  streak: number;
  now?: Date;
  tickMinutes?: number;
};

export type DailyReminderSkipReason =
  | "master_disabled"
  | "daily_reminder_disabled"
  | "not_due_time"
  | "quiet_hours"
  | "already_sent_today"
  | "miss_a_day_sent_today"
  | "meditated_today"
  | "frequency_skip";

export type DailyReminderEligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: DailyReminderSkipReason };

export function evaluateDailyReminderEligibility(
  input: DailyReminderEligibilityInput,
): DailyReminderEligibilityResult {
  const now = input.now ?? new Date();
  const tickMinutes = input.tickMinutes ?? SCHEDULER_TICK_MINUTES;
  const pref = input.preference;

  if (!pref.enabled) {
    return { eligible: false, reason: "master_disabled" };
  }
  if (!pref.dailyReminderEnabled) {
    return { eligible: false, reason: "daily_reminder_disabled" };
  }
  if (isWithinQuietHours(pref.quietHoursStart, pref.quietHoursEnd, pref.timezone, now)) {
    return { eligible: false, reason: "quiet_hours" };
  }
  if (!isPreferredTimeDue(pref.preferredTime, pref.timezone, tickMinutes, now)) {
    return { eligible: false, reason: "not_due_time" };
  }
  if (wasSentOnLocalCalendarDay(pref.lastDailyReminderSentAt, pref.timezone, now)) {
    return { eligible: false, reason: "already_sent_today" };
  }
  if (wasSentOnLocalCalendarDay(pref.lastMissADaySentAt, pref.timezone, now)) {
    return { eligible: false, reason: "miss_a_day_sent_today" };
  }
  if (input.hasCompletedSessionToday) {
    return { eligible: false, reason: "meditated_today" };
  }
  if (!matchesFrequency(pref, now)) {
    return { eligible: false, reason: "frequency_skip" };
  }

  return { eligible: true };
}

function matchesFrequency(pref: DailyReminderPreferenceRow, now: Date): boolean {
  if (pref.frequency === "daily") return true;

  const today = getLocalCalendarDate(pref.timezone, now);
  const anchor = getLocalCalendarDate(pref.timezone, pref.createdAt);

  if (pref.frequency === "every_other_day") {
    const days = daysBetweenIsoDatesInclusive(anchor, today);
    return days % 2 === 0;
  }

  if (pref.frequency === "weekly") {
    const anchorWeekday = getLocalWeekday(pref.timezone, pref.createdAt);
    const todayWeekday = getLocalWeekday(pref.timezone, now);
    return anchorWeekday === todayWeekday;
  }

  return true;
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

export function streakFromSessions(sessions: SessionStatsInput[]): number {
  return calculateSessionStats(sessions).streak;
}
