BEGIN;

-- === A) Schema-heal для sync_logs: гарантуємо обов'язкові поля ===

-- Якщо колонки відсутні — додамо (перестраховка)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sync_logs' AND column_name='trigger_type'
  ) THEN
    ALTER TABLE sync_logs ADD COLUMN trigger_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sync_logs' AND column_name='status'
  ) THEN
    ALTER TABLE sync_logs ADD COLUMN status text;
  END IF;
END$$;

-- Проставимо дефолти та задамо значення там, де NULL
UPDATE sync_logs SET trigger_type = COALESCE(trigger_type, 'manual');
ALTER TABLE sync_logs ALTER COLUMN trigger_type SET DEFAULT 'manual';

UPDATE sync_logs SET status = COALESCE(status, 'ok');
ALTER TABLE sync_logs ALTER COLUMN status SET DEFAULT 'ok';

-- === B) Кандидати до мерджу (лише провалідовані, ще не оброблені) ===
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
    rank,
    source,
    import_batch_id
  FROM staging_matches
  WHERE state = 'validated'
    AND processed_at IS NULL
    AND date_bucket IS NOT NULL
    AND pair_key    IS NOT NULL
),

-- === C) Вставляємо у matches; якщо вже є — DO NOTHING ===
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
),

-- === D) Підрахунок статистики ===
stats AS (
  SELECT
    (SELECT COUNT(*) FROM candidates) AS total,
    (SELECT COUNT(*) FROM ins)        AS inserted
),
mark AS (
  -- Позначаємо кандидатів як оброблених (merged) — ідемпотентно
  UPDATE staging_matches s
  SET processed_at = COALESCE(processed_at, now()),
      state        = 'merged'
  WHERE s.id IN (SELECT id FROM candidates)
  RETURNING 1
)

-- === E) Лог у sync_logs (враховуємо trigger_type/status) ===
INSERT INTO sync_logs (
  happened_at, op, trigger_type, status,
  source, import_batch_id,
  items_total, items_inserted, items_skipped, items_updated,
  details
)
SELECT
  now()                              AS happened_at,
  'merge'                            AS op,
  'manual'                           AS trigger_type,   -- або 'cron' у майбутньому планувальнику
  'ok'                               AS status,
  NULL::text                         AS source,
  NULL::text                         AS import_batch_id,
  st.total                           AS items_total,
  st.inserted                        AS items_inserted,
  GREATEST(st.total - st.inserted,0) AS items_skipped,
  0                                   AS items_updated,
  jsonb_build_object(
    'inserted_keys',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date_bucket', i.date_bucket, 'pair_key', i.pair_key))
      FROM ins i
    ), '[]'::jsonb)
  )                                   AS details
FROM stats st;

COMMIT;
