-- schema_migration_2025-09-10.sql
-- Архітектура v1.1. Ідемпотентно узгоджуємо схему.

BEGIN;

-- 1) matches
CREATE TABLE IF NOT EXISTS public.matches (
  id                BIGSERIAL PRIMARY KEY,
  kickoff_at        timestamptz,
  date_bucket       timestamptz,
  home_team         text,
  away_team         text,
  home_team_canon   text,
  away_team_canon   text,
  pair_key          text,
  tournament        text,
  link              text,
  link_version      int,
  link_last_changed_at timestamptz,
  rank              int,
  status            text, -- scheduled|live|finished|postponed|cancelled|hidden
  home_away_confidence text, -- high|medium|low
  seen              boolean DEFAULT false,
  comments          text,
  updated_at        timestamptz DEFAULT now(),
  updated_by        bigint,
  manual_overrides  jsonb,
  updated_cols      text[]
);

-- idempotent add columns (на випадок частково створеної таблиці)
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS kickoff_at           timestamptz,
  ADD COLUMN IF NOT EXISTS date_bucket          timestamptz,
  ADD COLUMN IF NOT EXISTS home_team            text,
  ADD COLUMN IF NOT EXISTS away_team            text,
  ADD COLUMN IF NOT EXISTS home_team_canon      text,
  ADD COLUMN IF NOT EXISTS away_team_canon      text,
  ADD COLUMN IF NOT EXISTS pair_key             text,
  ADD COLUMN IF NOT EXISTS tournament           text,
  ADD COLUMN IF NOT EXISTS link                 text,
  ADD COLUMN IF NOT EXISTS link_version         int,
  ADD COLUMN IF NOT EXISTS link_last_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rank                 int,
  ADD COLUMN IF NOT EXISTS status               text,
  ADD COLUMN IF NOT EXISTS home_away_confidence text,
  ADD COLUMN IF NOT EXISTS seen                 boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS comments             text,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by           bigint,
  ADD COLUMN IF NOT EXISTS manual_overrides     jsonb,
  ADD COLUMN IF NOT EXISTS updated_cols         text[];

-- date_bucket як нормалізація kickoff_at до хвилини (не тригером, а логікою аплікації; тут лише індекси/унакальність)
-- Унікальність: (date_bucket, pair_key)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uniq_matches_date_pair'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT uniq_matches_date_pair UNIQUE (date_bucket, pair_key);
  END IF;
END$$;

-- Індекси
CREATE INDEX IF NOT EXISTS idx_matches_kickoff_at ON public.matches (kickoff_at);
CREATE INDEX IF NOT EXISTS idx_matches_rank_desc  ON public.matches (rank DESC);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON public.matches (tournament);

-- 2) preferences (1 row)
CREATE TABLE IF NOT EXISTS public.preferences (
  id         int PRIMARY KEY DEFAULT 1,
  sort_col   text,
  sort_order text,
  seen_color text,
  updated_at timestamptz DEFAULT now(),
  updated_by bigint
);
-- гарантуємо наявність 1го рядка
INSERT INTO public.preferences (id, sort_col, sort_order)
  VALUES (1, 'kickoff_at', 'desc')
  ON CONFLICT (id) DO NOTHING;

-- 3) settings (key/value)
CREATE TABLE IF NOT EXISTS public.settings (
  key   text PRIMARY KEY,
  value jsonb
);

-- 4) users
CREATE TABLE IF NOT EXISTS public.users (
  id            BIGSERIAL PRIMARY KEY,
  username      text UNIQUE,
  password_hash text,
  role          text CHECK (role IN ('admin','user')),
  created_at    timestamptz DEFAULT now(),
  last_login_at timestamptz
);

-- 5) sessions
CREATE TABLE IF NOT EXISTS public.sessions (
  sid        text PRIMARY KEY,
  user_id    bigint REFERENCES public.users(id) ON DELETE CASCADE,
  issued_at  timestamptz DEFAULT now(),
  expires_at timestamptz,
  revoked    boolean DEFAULT false
);

-- 6) rate_limits
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key       text PRIMARY KEY,
  count     int,
  reset_at  timestamptz,
  last_seen_at timestamptz
);

-- 7) sync_logs
CREATE TABLE IF NOT EXISTS public.sync_logs (
  id               BIGSERIAL PRIMARY KEY,
  started_at       timestamptz DEFAULT now(),
  finished_at      timestamptz,
  status           text, -- ok|skipped|failed
  inserted         int,
  updated          int,
  skipped          int,
  source           text, -- manual|scheduler|import:<name>
  actor_user_id    bigint REFERENCES public.users(id),
  idempotency_key  text,
  note             text,
  error            text
);

-- 8) match_changes (optional but recommended)
CREATE TABLE IF NOT EXISTS public.match_changes (
  id         BIGSERIAL PRIMARY KEY,
  match_id   bigint REFERENCES public.matches(id) ON DELETE CASCADE,
  changed_at timestamptz DEFAULT now(),
  source     text, -- auto|manual
  changed_by bigint REFERENCES public.users(id),
  diff       jsonb
);

-- 9) match_links
CREATE TABLE IF NOT EXISTS public.match_links (
  id         BIGSERIAL PRIMARY KEY,
  match_id   bigint REFERENCES public.matches(id) ON DELETE CASCADE,
  link       text,
  changed_at timestamptz DEFAULT now(),
  source     text -- auto|manual
);

-- 10) staging_matches (тільки source-поля + import_batch_id)
CREATE TABLE IF NOT EXISTS public.staging_matches (
  id                BIGSERIAL PRIMARY KEY,
  import_batch_id   uuid,
  kickoff_at        timestamptz,
  home_team         text,
  away_team         text,
  tournament        text,
  link              text,
  rank              int,
  status            text,
  home_away_confidence text
);
CREATE INDEX IF NOT EXISTS idx_staging_import_batch ON public.staging_matches (import_batch_id);

COMMIT;
-- Кінець schema_migration_2025-09-10.sql