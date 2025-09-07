BEGIN;

-- 17.3b — seed, який працює на цільовому ключі (date_bucket, pair_key)
-- НІЧОГО не чіпає при повторному запуску.

WITH seed_rows AS (
  SELECT
    TIMESTAMPTZ '2025-09-14 15:30:00+02' AS kickoff_at,
    'Arsenal'         AS home_team,
    'Chelsea'         AS away_team,
    'EPL'             AS league,
    'scheduled'       AS status
  UNION ALL
  SELECT
    TIMESTAMPTZ '2025-09-21 17:30:00+02',
    'Manchester City','Arsenal','EPL','scheduled'
),
canon AS (
  SELECT
    kickoff_at,
    league,
    status,
    home_team,
    away_team,
    lower(regexp_replace(trim(home_team), '\s+', ' ', 'g')) AS home_team_canon,
    lower(regexp_replace(trim(away_team), '\s+', ' ', 'g')) AS away_team_canon
  FROM seed_rows
),
prepared AS (
  SELECT
    kickoff_at,
    date_trunc('day', kickoff_at)                            AS date_bucket,
    league,
    status,
    home_team,
    away_team,
    home_team_canon,
    away_team_canon,
    CASE WHEN home_team_canon <= away_team_canon
         THEN home_team_canon || '|' || away_team_canon
         ELSE away_team_canon || '|' || home_team_canon
    END                                                      AS pair_key
  FROM canon
)
INSERT INTO matches (
  kickoff_at, date_bucket,
  league, status,
  home_team, away_team,
  home_team_canon, away_team_canon, pair_key,
  link_version
)
SELECT
  kickoff_at, date_bucket,
  league, status,
  home_team, away_team,
  home_team_canon, away_team_canon, pair_key,
  1 AS link_version
FROM prepared
ON CONFLICT ON CONSTRAINT uq_matches_bucket_pair DO NOTHING;

COMMIT;
