BEGIN;

-- 17.5b — Merge staging -> matches (idempotent, insert-only).

-- Кандидати до мерджу: лише валідовані, ще не оброблені
WITH candidates AS (
  SELECT
    id,
    kickoff_at,
    date_bucket,
    league,
    status,
    home_team,
    away_team,
    home_team_canon,
    away_team_canon,
    pair_key,
    tournament,
    link,
    link_version,
    link_last_changed_at,
    rank
  FROM staging_matches
  WHERE state = 'validated'
    AND processed_at IS NULL
    AND date_bucket IS NOT NULL
    AND pair_key    IS NOT NULL
),

-- Вставляємо; якщо вже є — DO NOTHING
ins AS (
  INSERT INTO matches (
    kickoff_at, date_bucket,
    league, status,
    home_team, away_team,
    home_team_canon, away_team_canon, pair_key,
    tournament, link, link_version, link_last_changed_at, rank,
    metadata, created_at, updated_at
  )
  SELECT
    c.kickoff_at, c.date_bucket,
    c.league, c.status,
    c.home_team, c.away_team,
    c.home_team_canon, c.away_team_canon, c.pair_key,
    c.tournament, c.link, c.link_version, c.link_last_changed_at, c.rank,
    '{}'::jsonb AS metadata,
    now() AS created_at,
    now() AS updated_at
  FROM candidates c
  ON CONFLICT ON CONSTRAINT uq_matches_bucket_pair DO NOTHING
  RETURNING date_bucket, pair_key
)

-- Позначаємо всі кандидатні staging-записи як merged (ідемпотентно)
UPDATE staging_matches s
SET processed_at = COALESCE(processed_at, now()),
    state        = 'merged'
WHERE s.id IN (SELECT id FROM candidates);

COMMIT;
