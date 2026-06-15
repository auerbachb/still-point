ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_deliverable" boolean DEFAULT true NOT NULL;
