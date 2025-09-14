BEGIN;

-- 5.1.e — унікальний ключ для валідних матчів (без NULL у ключових полях).
-- Захищає від дублювання того ж самого матчу у цій самій лізі/даті/пара команд.

CREATE UNIQUE INDEX IF NOT EXISTS ux_matches_natural_key
ON matches (league, kickoff_at, home_team, away_team)
WHERE league IS NOT NULL
  AND kickoff_at IS NOT NULL
  AND home_team IS NOT NULL
  AND away_team IS NOT NULL;

COMMIT;
