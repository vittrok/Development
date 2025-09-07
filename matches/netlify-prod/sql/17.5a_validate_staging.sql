BEGIN;

-- 17.5a — Validate/Canonize staging (idempotent)
-- Нічого не перетираємо довільно: оновлюємо лише підозрілі або порожні місця.
-- Результатом буде 'state=validated' для рядків, готових до мерджу.

-- 1) date_bucket: день від kickoff_at (заповнюємо лише якщо ще NULL)
UPDATE staging_matches
SET date_bucket = date_trunc('day', kickoff_at)
WHERE date_bucket IS NULL
  AND kickoff_at IS NOT NULL;

-- 2) Канонізація назв команд:
--    - trim
--    - стиснення багатопробілів
--    - lower-case
--    Оновлюємо лише якщо канон порожній/NULL або містить " vs ".
WITH canon_src AS (
  SELECT
    id,
    lower(regexp_replace(trim(home_team), '\s+', ' ', 'g')) AS h,
    lower(regexp_replace(trim(away_team), '\s+', ' ', 'g')) AS a
  FROM staging_matches
  WHERE
       home_team IS NOT NULL
   AND away_team IS NOT NULL
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

-- 3) pair_key: sorted(canon_home, canon_away) через '|'
UPDATE staging_matches
SET pair_key = CASE
  WHEN home_team_canon IS NULL OR away_team_canon IS NULL THEN NULL
  WHEN home_team_canon <= away_team_canon
    THEN home_team_canon || '|' || away_team_canon
  ELSE
    away_team_canon || '|' || home_team_canon
END
WHERE (pair_key IS NULL OR btrim(pair_key) = '')
  AND home_team_canon IS NOT NULL
  AND away_team_canon IS NOT NULL;

-- 4) Позначаємо валідовані (готові до мерджу) рядки
UPDATE staging_matches
SET state = 'validated'
WHERE state IS DISTINCT FROM 'validated'
  AND processed_at IS NULL
  AND date_bucket IS NOT NULL
  AND pair_key    IS NOT NULL;

COMMIT;
