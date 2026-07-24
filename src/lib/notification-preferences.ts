import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";

export type DailyReminderFrequency = "daily" | "every_other" | "weekly";

export type NotificationPreferencesRow = {
  userId: string;
  pushEnabled: boolean;
  dailyReminderEnabled: boolean;
  missADayEnabled: boolean;
  failureReasonReminderEnabled: boolean;
  friendRequestNotificationsEnabled: boolean;
  suppressDuringSession: boolean;
  dailyReminderTime: string;
  dailyReminderFrequency: DailyReminderFrequency;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  callOptIn: boolean;
  callPhoneNumber: string | null;
  callConsentAt: Date | null;
  callWindowStart: string | null;
  callWindowStop: string | null;
  tz: string;
  createdAt: Date;
  updatedAt: Date;
};

const frequencyValues = new Set<DailyReminderFrequency>(["daily", "every_other", "weekly"]);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const e164Pattern = /^\+[1-9]\d{1,14}$/;

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  pushEnabled: false,
  dailyReminderEnabled: false,
  missADayEnabled: false,
  failureReasonReminderEnabled: false,
  friendRequestNotificationsEnabled: true,
  suppressDuringSession: false,
  dailyReminderTime: "09:00",
  dailyReminderFrequency: "daily" as DailyReminderFrequency,
  quietHoursStart: null as string | null,
  quietHoursEnd: null as string | null,
  callOptIn: false,
  callPhoneNumber: null as string | null,
  callConsentAt: null as Date | null,
  callWindowStart: null as string | null,
  callWindowStop: null as string | null,
  tz: "UTC",
};

export function isValidReminderTime(value: string): boolean {
  return timePattern.test(value);
}

export function isValidE164PhoneNumber(value: string): boolean {
  return e164Pattern.test(value) && value.length >= 8 && value.length <= 16;
}

export function isValidCallWindow(start: string, stop: string): boolean {
  if (!isValidReminderTime(start) || !isValidReminderTime(stop)) {
    return false;
  }
  return start !== stop;
}

export type CallPreferenceFields = Pick<
  NotificationPreferencesRow,
  "callOptIn" | "callPhoneNumber" | "callConsentAt" | "callWindowStart" | "callWindowStop"
>;

export function callOptInRequirementsMet(
  fields: Pick<NotificationPreferencesRow, "callPhoneNumber" | "callWindowStart" | "callWindowStop">,
): boolean {
  return Boolean(
    fields.callPhoneNumber
      && fields.callWindowStart
      && fields.callWindowStop
      && isValidE164PhoneNumber(fields.callPhoneNumber)
      && isValidCallWindow(fields.callWindowStart, fields.callWindowStop),
  );
}

export function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isValidFrequency(value: string): value is DailyReminderFrequency {
  return frequencyValues.has(value as DailyReminderFrequency);
}

export function asNotificationPreferencesRow(
  row: typeof notificationPreferences.$inferSelect,
): NotificationPreferencesRow {
  const frequency = row.dailyReminderFrequency;
  if (!isValidFrequency(frequency)) {
    throw new Error(`Invalid dailyReminderFrequency: ${frequency}`);
  }
  return { ...row, dailyReminderFrequency: frequency };
}

export function serializeNotificationPreferences(row: NotificationPreferencesRow) {
  return {
    pushEnabled: row.pushEnabled,
    dailyReminderEnabled: row.dailyReminderEnabled,
    missADayEnabled: row.missADayEnabled,
    failureReasonReminderEnabled: row.failureReasonReminderEnabled,
    friendRequestNotificationsEnabled: row.friendRequestNotificationsEnabled,
    suppressDuringSession: row.suppressDuringSession,
    dailyReminderTime: row.dailyReminderTime,
    dailyReminderFrequency: row.dailyReminderFrequency,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    callOptIn: row.callOptIn,
    callPhoneNumber: row.callPhoneNumber,
    callConsentAt: row.callConsentAt?.toISOString() ?? null,
    callWindowStart: row.callWindowStart,
    callWindowStop: row.callWindowStop,
    tz: row.tz,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** True when friend-request pushes may be sent for this user. */
export function friendRequestNotificationsAllowed(prefs: Pick<
  NotificationPreferencesRow,
  "pushEnabled" | "friendRequestNotificationsEnabled"
>): boolean {
  return prefs.pushEnabled && prefs.friendRequestNotificationsEnabled;
}

export async function getOrCreateNotificationPreferences(userId: string): Promise<NotificationPreferencesRow> {
  const existing = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  if (existing[0]) {
    return asNotificationPreferencesRow(existing[0]);
  }

  const now = new Date();
  const [created] = await db
    .insert(notificationPreferences)
    .values({
      userId,
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (created) {
    return asNotificationPreferencesRow(created);
  }

  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  if (!row) {
    throw new Error(`Failed to get or create notification preferences for user ${userId}`);
  }
  return asNotificationPreferencesRow(row);
}
