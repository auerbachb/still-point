-- Opt-in ambient sound level capture during solo sits (issue #563).
-- Default false so the feature is off until the user enables it in Settings.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ambient_sound_enabled" boolean DEFAULT false NOT NULL;
