import {
  NOTIFICATION_FREQUENCIES,
  type NotificationFrequency,
  type NotificationPreferencesRow,
} from "@/lib/notifications/types";
import { isValidIanaTimezone, isValidTimeOfDay } from "@/lib/notifications/time";

export const DEFAULT_NOTIFICATION_PREFERENCES: Omit<NotificationPreferencesRow, "userId"> = {
  pushEnabled: false,
  timezone: "UTC",
  reminderTime: "09:00",
  frequency: "daily",
  quietHoursStart: null,
  quietHoursEnd: null,
  dailyReminderEnabled: true,
  missADayEnabled: true,
};

export function isNotificationFrequency(value: string): value is NotificationFrequency {
  return (NOTIFICATION_FREQUENCIES as readonly string[]).includes(value);
}

export type PreferencesPatch = Partial<{
  pushEnabled: boolean;
  timezone: string;
  reminderTime: string;
  frequency: NotificationFrequency;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  dailyReminderEnabled: boolean;
  missADayEnabled: boolean;
}>;

export type PreferencesValidationResult =
  | { ok: true; patch: PreferencesPatch }
  | { ok: false; error: string };

export function validatePreferencesPatch(body: unknown): PreferencesValidationResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON body" };
  }

  const record = body as Record<string, unknown>;
  const patch: PreferencesPatch = {};

  if ("pushEnabled" in record) {
    if (typeof record.pushEnabled !== "boolean") {
      return { ok: false, error: "pushEnabled must be a boolean" };
    }
    patch.pushEnabled = record.pushEnabled;
  }

  if ("timezone" in record) {
    if (typeof record.timezone !== "string" || !isValidIanaTimezone(record.timezone)) {
      return { ok: false, error: "timezone must be a valid IANA timezone" };
    }
    patch.timezone = record.timezone;
  }

  if ("reminderTime" in record) {
    if (typeof record.reminderTime !== "string" || !isValidTimeOfDay(record.reminderTime)) {
      return { ok: false, error: "reminderTime must be HH:MM (24h)" };
    }
    patch.reminderTime = record.reminderTime;
  }

  if ("frequency" in record) {
    if (typeof record.frequency !== "string" || !isNotificationFrequency(record.frequency)) {
      return { ok: false, error: "frequency must be daily, every_other_day, or weekly" };
    }
    patch.frequency = record.frequency;
  }

  if ("quietHoursStart" in record) {
    const value = record.quietHoursStart;
    if (value !== null && (typeof value !== "string" || !isValidTimeOfDay(value))) {
      return { ok: false, error: "quietHoursStart must be HH:MM or null" };
    }
    patch.quietHoursStart = value as string | null;
  }

  if ("quietHoursEnd" in record) {
    const value = record.quietHoursEnd;
    if (value !== null && (typeof value !== "string" || !isValidTimeOfDay(value))) {
      return { ok: false, error: "quietHoursEnd must be HH:MM or null" };
    }
    patch.quietHoursEnd = value as string | null;
  }

  if ("dailyReminderEnabled" in record) {
    if (typeof record.dailyReminderEnabled !== "boolean") {
      return { ok: false, error: "dailyReminderEnabled must be a boolean" };
    }
    patch.dailyReminderEnabled = record.dailyReminderEnabled;
  }

  if ("missADayEnabled" in record) {
    if (typeof record.missADayEnabled !== "boolean") {
      return { ok: false, error: "missADayEnabled must be a boolean" };
    }
    patch.missADayEnabled = record.missADayEnabled;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No supported preference fields provided" };
  }

  return { ok: true, patch };
}

export function serializePreferences(row: NotificationPreferencesRow) {
  return {
    pushEnabled: row.pushEnabled,
    timezone: row.timezone,
    reminderTime: row.reminderTime,
    frequency: row.frequency,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    dailyReminderEnabled: row.dailyReminderEnabled,
    missADayEnabled: row.missADayEnabled,
  };
}
