BEGIN;

-- 5.1.g2 — seed контрольних матчів EPL з гарантією ідемпотентності
-- Вимагає існування унікального констрейнта:
--   ALTER TABLE matches ADD CONSTRAINT uq_matches_natural_key UNIQUE (league, kickoff_at, home_team, away_team);

INSERT INTO matches (league, kickoff_at, home_team, away_team, status)
VALUES
  ('EPL', TIMESTAMPTZ '2025-09-14 15:30:00+02', 'Arsenal',         'Chelsea',           'scheduled'),
  ('EPL', TIMESTAMPTZ '2025-09-21 17:30:00+02', 'Manchester City', 'Arsenal',           'scheduled')
ON CONFLICT ON CONSTRAINT uq_matches_natural_key DO NOTHING;

COMMIT;
