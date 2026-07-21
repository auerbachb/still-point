-- Ambient sound level summary captured during a solo sit (issue #563).
-- Single jsonb column storing { avgDb, peakDb, quietPercent, loudPercent, sampleCount }.
-- Null when the user had the feature disabled or when mic permission was denied.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "ambient_sound_summary" jsonb;
