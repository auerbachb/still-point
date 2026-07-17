-- #557: iOS offline write-queue idempotency — client-supplied session UUID.
-- Nullable so web and legacy clients are unchanged; partial unique index only
-- applies when client_session_id is present.
-- Idempotent + safe to re-run. Do NOT edit after applied (schema_migrations checksum).

ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "client_session_id" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "sessions_user_client_session_unique"
ON "sessions" ("user_id", "client_session_id")
WHERE "client_session_id" IS NOT NULL;
