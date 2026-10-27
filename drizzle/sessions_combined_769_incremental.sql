-- #890 (combine today's sits 1/5, #769): a combined sit is today's two sits done
-- as one, stored as a single standard sit on the primary track. A completed one
-- also advances the second track. Defaults to false, so every existing row reads
-- as an ordinary sit.
-- Idempotent + safe to re-run. Do NOT edit after it is applied (the
-- schema_migrations checksum ledger will reject a changed body).

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "combined" boolean NOT NULL DEFAULT false;
