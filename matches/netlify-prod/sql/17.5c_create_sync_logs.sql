BEGIN;

-- 17.5c (fixed) — sync_logs: ідемпотентне створення + вирівнювання схеми + індекси

-- 1) Мінімальний каркас таблиці
CREATE TABLE IF NOT EXISTS sync_logs (
  id bigserial PRIMARY KEY
);

-- 2) Вирівнюємо колонки (додаємо відсутні)
ALTER TABLE sync_logs
  ADD COLUMN IF NOT EXISTS happened_at      timestamptz NOT NULL DEFAULT now(), -- коли сталася подія
  ADD COLUMN IF NOT EXISTS op               text NOT NULL DEFAULT 'merge',      -- 'import' | 'validate' | 'merge' | ...
  ADD COLUMN IF NOT EXISTS source           text,                                -- ім'я джерела ('manual','scraper',...)
  ADD COLUMN IF NOT EXISTS import_batch_id  text,                                -- ідентифікатор батча, якщо є
  ADD COLUMN IF NOT EXISTS items_total      int,
  ADD COLUMN IF NOT EXISTS items_inserted   int,
  ADD COLUMN IF NOT EXISTS items_skipped    int,
  ADD COLUMN IF NOT EXISTS items_updated    int,
  ADD COLUMN IF NOT EXISTS details          jsonb;

-- (опційно) якщо колись була колонка created_at — підстрахуємо бекфіл happened_at з неї
UPDATE sync_logs
SET happened_at = COALESCE(happened_at, now())
WHERE happened_at IS NULL;

-- 3) Індекси (ідемпотентно)
CREATE INDEX IF NOT EXISTS ix_sync_logs_when
  ON sync_logs (happened_at DESC);

CREATE INDEX IF NOT EXISTS ix_sync_logs_op
  ON sync_logs (op, happened_at DESC);

CREATE INDEX IF NOT EXISTS ix_sync_logs_source
  ON sync_logs (source, happened_at DESC);

COMMIT;
