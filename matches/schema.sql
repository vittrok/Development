-- Bring matches to target shape (idempotent)
CREATE TABLE IF NOT EXISTS matches (
  date DATE NOT NULL,
  match TEXT NOT NULL,
  tournament TEXT,
  link TEXT,
  seen BOOLEAN NOT NULL DEFAULT FALSE,
  comments TEXT
);

-- Add missing columns (safe)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS tournament TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS seen BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS comments TEXT;

-- Enforce uniqueness by (date, match)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_date_match_key') THEN
    ALTER TABLE matches ADD CONSTRAINT matches_date_match_key UNIQUE (date, match);
  END IF;
END $$;

-- Global sort preferences (single row)
CREATE TABLE IF NOT EXISTS preferences (
  sort_col TEXT,
  sort_order TEXT
);
INSERT INTO preferences(sort_col, sort_order)
SELECT 'date','asc' WHERE NOT EXISTS (SELECT 1 FROM preferences);

-- Global settings (e.g., seen color)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings(key, value)
SELECT 'seen_color','lightyellow'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key='seen_color');

-- Sync logs for audit
CREATE TABLE IF NOT EXISTS sync_logs (
  id BIGSERIAL PRIMARY KEY,
  sync_time TIMESTAMP NOT NULL DEFAULT NOW(),
  trigger_type TEXT NOT NULL, -- 'manual' | 'cron'
  client_ip TEXT,
  new_matches INT DEFAULT 0,
  skipped_matches INT DEFAULT 0
);

-- users (single admin for now)
CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- sessions
CREATE TABLE IF NOT EXISTS sessions(
  sid TEXT PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false
);

-- rate_limits (fixed window)
CREATE TABLE IF NOT EXISTS rate_limits(
  key TEXT PRIMARY KEY,
  count INT NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);

-- seed single admin from env on first login: row is created lazily by /login
-- (тобто /login сам створює користувача, якщо його ще немає)
