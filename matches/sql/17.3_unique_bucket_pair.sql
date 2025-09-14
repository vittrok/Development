BEGIN;

-- 17.3 — цільова унікальність за архітектурою v1.1:
--         (date_bucket, pair_key)
-- Ідемпотентно: IF NOT EXISTS + USING INDEX → ON CONFLICT зможемо використовувати по імені констрейнта.

-- 1) Унікальний індекс (повний, без WHERE)
CREATE UNIQUE INDEX IF NOT EXISTS ux_matches_bucket_pair
ON matches (date_bucket, pair_key);

-- 2) Прив'язуємо індекс як табличний констрейнт для ON CONFLICT ON CONSTRAINT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'matches'
      AND c.conname = 'uq_matches_bucket_pair'
  ) THEN
    ALTER TABLE matches
      ADD CONSTRAINT uq_matches_bucket_pair
      UNIQUE USING INDEX ux_matches_bucket_pair;
  END IF;
END
$$;

COMMIT;
