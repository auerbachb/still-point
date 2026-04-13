-- Buddy shared sessions (#117). Apply to Neon/Postgres after friend graph migration if needed.

CREATE TABLE IF NOT EXISTS buddy_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_token varchar(48) NOT NULL UNIQUE,
  host_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state varchar(20) NOT NULL DEFAULT 'waiting',
  duration_seconds integer NOT NULL,
  started_at timestamptz,
  revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buddy_sessions_state_allowed CHECK (
    state IN ('waiting', 'ready_check', 'active', 'completed', 'abandoned')
  )
);

CREATE INDEX IF NOT EXISTS idx_buddy_sessions_host ON buddy_sessions(host_user_id);

CREATE TABLE IF NOT EXISTS buddy_session_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buddy_session_id uuid NOT NULL REFERENCES buddy_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_host boolean NOT NULL DEFAULT false,
  ready boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  participant_completed_at timestamptz,
  CONSTRAINT buddy_session_participants_session_user UNIQUE (buddy_session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_buddy_participants_session ON buddy_session_participants(buddy_session_id);
