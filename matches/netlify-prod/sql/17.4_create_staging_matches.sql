BEGIN;

-- 17.4 — Таблиця сирих імпортів перед валідацією/мерджем у matches.
-- Мінімально потрібні поля + місце для канонів/ключа, щоб пришвидшити подальший merge.
-- Нічого не чіпаємо в існуючих таблицях.

CREATE TABLE IF NOT EXISTS staging_matches (
  id                      bigserial PRIMARY KEY,
  imported_at             timestamptz NOT NULL DEFAULT now(),  -- коли завантажено у staging
  source                  text,                                -- ім’я/ідентифікатор джерела (наприклад, "web_scraper")
  league                  text,
  tournament              text,
  link                    text,
  link_version            int,
  link_last_changed_at    timestamptz,
  kickoff_at              timestamptz,                         -- оригінальний час з джерела
  date_bucket             timestamptz,                         -- day-level; бекфіл окремо
  home_team               text,
  away_team               text,
  status                  text,                                -- як прийшло з джерела (не обов’язково our enum)
  rank                    int,                                 -- пріоритет/важливість, якщо є
  raw                     jsonb,                               -- повний сирий об’єкт із джерела (опційно)
  errors                  jsonb,                               -- помилки валідації, якщо є

  -- Канонізація у staging (для швидкого merge по нашому ключу)
  home_team_canon         text,
  away_team_canon         text,
  pair_key                text,

  -- Позначки процесингу
  processed_at            timestamptz,                         -- коли було змерджено/оброблено
  state                   text                                  -- 'new' | 'validated' | 'merged' | 'rejected' (інформативно)
);

-- Індекси під найчастіші операції:
CREATE INDEX IF NOT EXISTS ix_staging_imported_at
  ON staging_matches (imported_at DESC);

CREATE INDEX IF NOT EXISTS ix_staging_link
  ON staging_matches (link);

-- Для швидкого пошуку кандидатів на мердж по нашому ключу
CREATE INDEX IF NOT EXISTS ix_staging_bucket_pair
  ON staging_matches (date_bucket, pair_key)
  WHERE date_bucket IS NOT NULL AND pair_key IS NOT NULL;

-- Під фільтри/черги обробки
CREATE INDEX IF NOT EXISTS ix_staging_state
  ON staging_matches (state, imported_at DESC);

COMMIT;
