CREATE TABLE IF NOT EXISTS "apple_notification_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" varchar(50) NOT NULL,
  "subject" varchar(255) NOT NULL,
  "event_time" timestamp with time zone,
  "jti" varchar(255),
  "user_id" uuid,
  "action_taken" varchar(64) NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_apple_notification_log_subject"
  ON "apple_notification_log" ("subject");

CREATE INDEX IF NOT EXISTS "idx_apple_notification_log_user"
  ON "apple_notification_log" ("user_id");
