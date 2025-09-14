BEGIN;

-- Повний (без WHERE) унікальний індекс на природний ключ поточної схеми
CREATE UNIQUE INDEX IF NOT EXISTS ux_matches_natural_key_full
ON matches (league, kickoff_at, home_team, away_team);

-- Прив’язуємо індекс як табличний констрейнт (зручно для ON CONFLICT ON CONSTRAINT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'matches'
      AND c.conname = 'uq_matches_natural_key'
  ) THEN
    ALTER TABLE matches
      ADD CONSTRAINT uq_matches_natural_key
      UNIQUE USING INDEX ux_matches_natural_key_full;
  END IF;
END
$$;

COMMIT;
