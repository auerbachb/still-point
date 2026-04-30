-- Incremental DDL for OAuth provider account linking (issue #136).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).
-- This file is the manual-apply reference for existing databases (prod / preview branches).
--
-- Stores one row per (provider, provider_account_id) pair, linking it to a
-- users.id. A single user may have multiple oauth_accounts rows (one per
-- provider). The unique index on (provider, provider_account_id) prevents
-- the same external identity from being linked to two different local users.
--
-- Provider check covers the four providers planned for #136 + follow-up
-- issues #284 (microsoft), #285 (facebook), #286 (apple). Today only
-- 'google' is wired in product code; the other values are reserved.
--
-- Idempotent (IF NOT EXISTS) and atomic (BEGIN/COMMIT).

BEGIN;

CREATE TABLE IF NOT EXISTS "oauth_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" varchar(32) NOT NULL,
  "provider_account_id" varchar(255) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "oauth_accounts_provider_allowed"
    CHECK ("provider" IN ('google', 'apple', 'facebook', 'microsoft-entra-id'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_accounts_provider_account_unique"
  ON "oauth_accounts" ("provider", "provider_account_id");

CREATE INDEX IF NOT EXISTS "idx_oauth_accounts_user"
  ON "oauth_accounts" ("user_id");

COMMIT;
