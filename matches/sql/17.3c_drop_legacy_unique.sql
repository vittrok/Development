BEGIN;

-- 17.3c — прибираємо застарілу унікальність на (league, kickoff_at, home_team, away_team)

-- 1) Дропаємо табличний констрейнт, якщо він існує.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'matches'
      AND c.conname = 'uq_matches_natural_key'
  ) THEN
    ALTER TABLE matches
      DROP CONSTRAINT uq_matches_natural_key;
  END IF;
END
$$;

-- 2) На випадок, якщо індекс залишився «осиротілим» (залежить від того, як створювали USING INDEX).
DROP INDEX IF EXISTS ux_matches_natural_key_full;

-- Примітка: частковий індекс ux_matches_natural_key (якщо робили раніше) залишаємо —
-- він може допомагати планувальнику на фільтрах за league/home/away/kickoff.
-- Якщо захочеш прибрати і його — окремий мікрокрок.

COMMIT;
