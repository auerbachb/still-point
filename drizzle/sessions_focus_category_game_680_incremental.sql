-- #680 (focus games, web v1): the focus game saves as a focus session under the
-- category 'game'. Widens the focus-category CHECK from three values to four.
-- Additive only: every existing row still satisfies the wider constraint.
-- Sorts after sessions_focus_category_837_incremental.sql (which creates the
-- constraint this replaces), so a fresh database always ends with the wider one.
-- Idempotent + safe to re-run. Do NOT edit after it is applied (the
-- schema_migrations checksum ledger will reject a changed body).

ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_focus_category_allowed";
ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_focus_category_allowed"
CHECK ("focus_category" IS NULL OR "focus_category" IN ('reading', 'writing', 'listening', 'game'));
