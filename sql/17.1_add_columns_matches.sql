BEGIN;

-- 17.1 — підготовка до канонізації та унікальності (date_bucket, pair_key)
-- Усе nullable і з IF NOT EXISTS, щоб не чіпати існуючі дані.

-- Ключова ідентичність (буде цільовий ключ разом із pair_key)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS date_bucket           timestamptz;

-- Канонізація назв команд та пара
ALTER TABLE matches ADD COLUMN IF NOT EXISTS home_team_canon       text;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS away_team_canon       text;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS pair_key              text;

-- Поля джерела/метаданих синку
ALTER TABLE matches ADD COLUMN IF NOT EXISTS tournament            text;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS link                  text;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS link_version          int;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS link_last_changed_at  timestamptz;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS rank                  int;

-- Сервісні/аудитні та ручні правки
-- (updated_at уже може існувати — IF NOT EXISTS нічого не змінить)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS updated_at            timestamptz;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS updated_by            int;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS manual_overrides      jsonb;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS updated_cols          text[];

COMMIT;
