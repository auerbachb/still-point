export const NOTIFICATION_TYPES = ["daily_reminder", "miss_a_day"] as const;

export type ScheduledNotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_FREQUENCIES = ["daily", "every_other_day", "weekly"] as const;

export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCIES)[number];

export type NotificationPreferencesRow = {
  userId: string;
  pushEnabled: boolean;
  timezone: string;
  reminderTime: string;
  frequency: NotificationFrequency;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  dailyReminderEnabled: boolean;
  missADayEnabled: boolean;
};

export type NotificationTickCandidate = NotificationPreferencesRow & {
  currentDay: number;
};
