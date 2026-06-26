-- #441 review (CodeAnt): the v1 btrim()-based check only trims plain spaces, so a note
-- made entirely of tabs/newlines still passed and would be treated as "logged",
-- suppressing the reminder. Replace it with a whitespace-aware check that requires at
-- least one non-whitespace character. New incremental file (append-only) because the v1
-- file is already applied to the shared preview branch (#368/#370 checksum guard).

DO $$
BEGIN
  ALTER TABLE "failure_reasons" DROP CONSTRAINT IF EXISTS "failure_reasons_text_not_blank";
  ALTER TABLE "failure_reasons"
    ADD CONSTRAINT "failure_reasons_text_not_blank"
    CHECK ("text" ~ '[^[:space:]]');
END $$;
