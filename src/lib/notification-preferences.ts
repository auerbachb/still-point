import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";

export type DailyReminderFrequency = "daily" | "every_other" | "weekly";

export type NotificationPreferencesRow = {
  userId: string;
  pushEnabled: boolean;
  dailyReminderEnabled: boolean;
  missADayEnabled: boolean;
  dailyReminderTime: string;
  dailyReminderFrequency: DailyReminderFrequency;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  tz: string;
  createdAt: Date;
  updatedAt: Date;
};

const frequencyValues = new Set<DailyReminderFrequency>(["daily", "every_other", "weekly"]);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  pushEnabled: false,
  dailyReminderEnabled: false,
  missADayEnabled: false,
  dailyReminderTime: "09:00",
  dailyReminderFrequency: "daily" as DailyReminderFrequency,
  quietHoursStart: null as string | null,
  quietHoursEnd: null as string | null,
  tz: "UTC",
};

export function isValidReminderTime(value: string): boolean {
  return timePattern.test(value);
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
    dailyReminderTime: row.dailyReminderTime,
    dailyReminderFrequency: row.dailyReminderFrequency,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    tz: row.tz,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOrCreateNotificationPreferences(userId: string): Promise<NotificationPreferencesRow> {
  const existing = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  if (existing[0]) {
    return existing[0] as NotificationPreferencesRow;
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
    return created as NotificationPreferencesRow;
  }

  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  return row as NotificationPreferencesRow;
}
