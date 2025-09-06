BEGIN;

-- 5.1.g — seed контрольних матчів EPL з явною ідемпотентністю
-- Спирається на унікальний (частковий) індекс ux_matches_natural_key
-- по (league, kickoff_at, home_team, away_team).

INSERT INTO matches (league, kickoff_at, home_team, away_team, status)
VALUES
  ('EPL', TIMESTAMPTZ '2025-09-14 15:30:00+02', 'Arsenal',         'Chelsea',           'scheduled'),
  ('EPL', TIMESTAMPTZ '2025-09-21 17:30:00+02', 'Manchester City', 'Arsenal',           'scheduled')
ON CONFLICT (league, kickoff_at, home_team, away_team) DO NOTHING;

COMMIT;
