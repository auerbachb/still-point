-- Widen scheduler candidate index (#531): the dispatch query ORs
-- miss_a_day_enabled and failure_reason_reminder_enabled (#440/#441) but the
-- original index only covered daily-reminder columns. Include all opt-in flags
-- so push-enabled rows with only miss-a-day / failure-reason toggles aren't
-- heap-filtered at scale.

DROP INDEX IF EXISTS "idx_notification_preferences_dispatch";

CREATE INDEX IF NOT EXISTS "idx_notification_preferences_dispatch" ON "notification_preferences" USING btree (
  "push_enabled",
  "daily_reminder_enabled",
  "miss_a_day_enabled",
  "failure_reason_reminder_enabled",
  "daily_reminder_time"
);
