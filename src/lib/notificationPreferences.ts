import { isValidTimeFormat } from "./notificationTime";

export const NOTIFICATION_FREQUENCIES = ["daily", "every_other_day", "weekly"] as const;
export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCIES)[number];

export type NotificationPreferencesData = {
  enabled: boolean;
  dailyReminderEnabled: boolean;
  preferredTime: string;
  frequency: NotificationFrequency;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
};

export function getDefaultPreferences(): NotificationPreferencesData {
  return {
    enabled: false,
    dailyReminderEnabled: true,
    preferredTime: "09:00",
    frequency: "daily",
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: "America/New_York",
  };
}

export function isValidFrequency(freq: string): freq is NotificationFrequency {
  return (NOTIFICATION_FREQUENCIES as readonly string[]).includes(freq);
}

export { isValidTimeFormat };

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function serializeNotificationPreferences(
  row: {
    enabled: boolean;
    dailyReminderEnabled: boolean;
    preferredTime: string;
    frequency: string;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    timezone: string;
  } | null | undefined,
): NotificationPreferencesData {
  if (!row) return getDefaultPreferences();
  return {
    enabled: row.enabled,
    dailyReminderEnabled: row.dailyReminderEnabled,
    preferredTime: row.preferredTime,
    frequency: isValidFrequency(row.frequency) ? row.frequency : "daily",
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    timezone: row.timezone,
  };
}
