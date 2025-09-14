BEGIN;

-- 17.2 — Backfill канонічних полів і ключів.
-- ІДЕМПОТЕНТНО: оновлюємо лише там, де нині NULL.

-- 1) date_bucket = день початку матчу (truncate до дня)
UPDATE matches
SET date_bucket = date_trunc('day', kickoff_at)
WHERE date_bucket IS NULL
  AND kickoff_at IS NOT NULL;

-- 2) Канонізація назв команд (проста нормалізація)
--    - trim
--    - стиснення багатопробілів до одного
--    - lower-case (канон у нижньому регістрі; UI лишається як є)
UPDATE matches
SET home_team_canon = lower(regexp_replace(trim(home_team), '\s+', ' ', 'g'))
WHERE home_team IS NOT NULL
  AND home_team_canon IS NULL;

UPDATE matches
SET away_team_canon = lower(regexp_replace(trim(away_team), '\s+', ' ', 'g'))
WHERE away_team IS NOT NULL
  AND away_team_canon IS NULL;

-- 3) Порядок-незалежний pair_key = sorted(canon_home, canon_away) через '|'
UPDATE matches
SET pair_key = CASE
  WHEN home_team_canon IS NULL OR away_team_canon IS NULL THEN NULL
  WHEN home_team_canon <= away_team_canon
    THEN home_team_canon || '|' || away_team_canon
  ELSE
    away_team_canon || '|' || home_team_canon
END
WHERE pair_key IS NULL
  AND home_team_canon IS NOT NULL
  AND away_team_canon IS NOT NULL;

-- 4) Початкова ініціалізація версії посилання (якщо є link, але немає версії)
UPDATE matches
SET link_version = 1
WHERE link IS NOT NULL
  AND link_version IS NULL;

COMMIT;
