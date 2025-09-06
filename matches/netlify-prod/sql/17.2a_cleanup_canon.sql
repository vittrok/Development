BEGIN;

-- 17.2a — Очистка/виправлення канонів там, де вони виглядають підозріло:
-- - містять " vs "
-- - або порожні (''), або NULL
-- Перерахунок pair_key із коректних канонів.

WITH c AS (
  SELECT
    id,
    lower(regexp_replace(trim(home_team), '\s+', ' ', 'g')) AS h,
    lower(regexp_replace(trim(away_team), '\s+', ' ', 'g')) AS a
  FROM matches
  WHERE
        home_team_canon ~* '\s+vs\s+'
     OR away_team_canon  ~* '\s+vs\s+'
     OR home_team_canon IS NULL OR btrim(home_team_canon) = ''
     OR away_team_canon IS NULL OR btrim(away_team_canon) = ''
)
UPDATE matches m
SET
  home_team_canon = c.h,
  away_team_canon = c.a,
  pair_key = CASE
               WHEN c.h <= c.a THEN c.h || '|' || c.a
               ELSE                 c.a || '|' || c.h
             END
FROM c
WHERE m.id = c.id;

COMMIT;
