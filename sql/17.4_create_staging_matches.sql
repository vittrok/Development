BEGIN;

-- 17.4 — staging_matches (робимо ідемпотентно та "schema-heal")

-- 1) Гарантуємо наявність таблиці (мінімальний каркас)
CREATE TABLE IF NOT EXISTS staging_matches (
  id bigserial PRIMARY KEY
);

-- 2) Вирівнюємо колонки (нічого не ламає — лише додає відсутні)
ALTER TABLE staging_matches
  ADD COLUMN IF NOT EXISTS imported_at             timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS source                  text,
  ADD COLUMN IF NOT EXISTS league                  text,
  ADD COLUMN IF NOT EXISTS tournament              text,
  ADD COLUMN IF NOT EXISTS link                    text,
  ADD COLUMN IF NOT EXISTS link_version            int,
  ADD COLUMN IF NOT EXISTS link_last_changed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS kickoff_at              timestamptz,
  ADD COLUMN IF NOT EXISTS date_bucket             timestamptz,
  ADD COLUMN IF NOT EXISTS home_team               text,
  ADD COLUMN IF NOT EXISTS away_team               text,
  ADD COLUMN IF NOT EXISTS status                  text,
  ADD COLUMN IF NOT EXISTS rank                    int,
  ADD COLUMN IF NOT EXISTS raw                     jsonb,
  ADD COLUMN IF NOT EXISTS errors                  jsonb,
  ADD COLUMN IF NOT EXISTS home_team_canon         text,
  ADD COLUMN IF NOT EXISTS away_team_canon         text,
  ADD COLUMN IF NOT EXISTS pair_key                text,
  ADD COLUMN IF NOT EXISTS processed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS state                   text;

-- 3) Індекси (ідемпотентно)
CREATE INDEX IF NOT EXISTS ix_staging_imported_at
  ON staging_matches (imported_at DESC);

CREATE INDEX IF NOT EXISTS ix_staging_link
  ON staging_matches (link);

CREATE INDEX IF NOT EXISTS ix_staging_bucket_pair
  ON staging_matches (date_bucket, pair_key)
  WHERE date_bucket IS NOT NULL AND pair_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_staging_state
  ON staging_matches (state, imported_at DESC);

COMMIT;
