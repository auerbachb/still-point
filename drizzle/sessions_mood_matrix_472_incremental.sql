-- #472: before/after mood matrix on the completion screen. Stores per-mood
-- before/after values (1–5) captured retrospectively at recap. Structure:
-- { calm: { before: 3, after: 4 }, focus: { before: 2, after: 5 }, ... }
-- Values are checked at the application layer (PATCH route) using the same
-- 1–5 range pattern. Nullable until the user taps at least one box.
-- Idempotent + safe to re-run (matches the runner contract in
-- scripts/apply-migrations.ts). Do NOT edit after it is applied (the
-- schema_migrations checksum ledger will reject a changed body).

ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "mood_matrix" jsonb;
