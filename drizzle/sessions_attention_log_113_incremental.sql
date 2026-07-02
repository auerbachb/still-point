-- iOS ARKit gaze attention log (issue #113). mindStateLog-style JSONB array of
-- { time: number, state: string } entries where state is "attentive" | "away".

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "attention_log" jsonb;
