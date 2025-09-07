CREATE OR REPLACE FUNCTION run_staging_validate_and_merge(
  p_trigger_type   text DEFAULT 'manual',
  p_source         text DEFAULT NULL,
  p_import_batch_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_total     int := 0;
  v_inserted  int := 0;
  v_skipped   int := 0;
BEGIN
  -- === Валідація у staging (як у 17.5a) ===

  -- 1) date_bucket від kickoff_at
  UPDATE staging_matches
  SET date_bucket = date_trunc('day', kickoff_at)
  WHERE date_bucket IS NULL
    AND kickoff_at IS NOT NULL;

  -- 2) Канони команд (trim → стиснення пробілів → lower)
  WITH canon_src AS (
    SELECT
      id,
      lower(regexp_replace(trim(home_team), '\s+', ' ', 'g')) AS h,
      lower(regexp_replace(trim(away_team), '\s+', ' ', 'g')) AS a
    FROM staging_matches
    WHERE home_team IS NOT NULL AND away_team IS NOT NULL
      AND (
           home_team_canon IS NULL OR btrim(home_team_canon) = '' OR home_team_canon ~* '\s+vs\s+'
        OR away_team_canon IS NULL OR btrim(away_team_canon) = '' OR away_team_canon ~* '\s+vs\s+'
      )
  )
  UPDATE staging_matches s
  SET home_team_canon = c.h,
      away_team_canon = c.a
  FROM canon_src c
  WHERE s.id = c.id;

  -- 3) pair_key = sorted(canon_home, canon_away)
  UPDATE staging_matches
  SET pair_key = CASE
    WHEN home_team_canon IS NULL OR away_team_canon IS NULL THEN NULL
    WHEN home_team_canon <= away_team_canon
      THEN home_team_canon || '|' || away_team_canon
    ELSE away_team_canon || '|' || home_team_canon
  END
  WHERE (pair_key IS NULL OR btrim(pair_key) = '')
    AND home_team_canon IS NOT NULL
    AND away_team_canon IS NOT NULL;

  -- 4) Позначити готові до мерджу
  UPDATE staging_matches
  SET state = 'validated'
  WHERE state IS DISTINCT FROM 'validated'
    AND processed_at IS NULL
    AND date_bucket IS NOT NULL
    AND pair_key    IS NOT NULL;

  -- === Підрахунок кандидатів ===
  SELECT COUNT(*) INTO v_total
  FROM staging_matches
  WHERE state='validated' AND processed_at IS NULL
    AND date_bucket IS NOT NULL AND pair_key IS NOT NULL;

  -- === Merge у matches (як у 17.5d) ===
  WITH candidates AS (
    SELECT
      id, kickoff_at, date_bucket, league, status,
      home_team, away_team,
      home_team_canon, away_team_canon, pair_key,
      tournament, link, link_version, link_last_changed_at, rank
    FROM staging_matches
    WHERE state='validated' AND processed_at IS NULL
      AND date_bucket IS NOT NULL AND pair_key IS NOT NULL
  ),
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
      now(), now()
    FROM candidates c
    ON CONFLICT ON CONSTRAINT uq_matches_bucket_pair DO NOTHING
    RETURNING 1
  )
  SELECT COALESCE(COUNT(*),0) INTO v_inserted FROM ins;

  v_skipped := GREATEST(v_total - v_inserted, 0);

  -- Позначити кандидатів як merged
  UPDATE staging_matches s
  SET processed_at = COALESCE(processed_at, now()),
      state        = 'merged'
  WHERE s.id IN (
    SELECT id FROM staging_matches
    WHERE state='validated' AND processed_at IS NULL
      AND date_bucket IS NOT NULL AND pair_key IS NOT NULL
  );

  -- === Лог у sync_logs (враховуємо обов'язкові поля) ===
  -- Страхуємо схему (може не знадобитися, але безпечно):
  DO $inner$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='sync_logs' AND column_name='trigger_type'
    ) THEN
      ALTER TABLE sync_logs ADD COLUMN trigger_type text DEFAULT 'manual';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='sync_logs' AND column_name='status'
    ) THEN
      ALTER TABLE sync_logs ADD COLUMN status text DEFAULT 'ok';
    END IF;
  END
  $inner$;

  INSERT INTO sync_logs (
    happened_at, op, trigger_type, status,
    source, import_batch_id,
    items_total, items_inserted, items_skipped, items_updated,
    details
  )
  VALUES (
    now(), 'merge', COALESCE(p_trigger_type,'manual'), 'ok',
    p_source, p_import_batch_id,
    v_total, v_inserted, v_skipped, 0,
    '{}'::jsonb
  );

  RETURN jsonb_build_object('total', v_total, 'inserted', v_inserted, 'skipped', v_skipped);
END
$$;
