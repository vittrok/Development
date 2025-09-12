-- File: matches/netlify-prod/migration.sql
-- Purpose: unify preferences storage to user_preferences (jsonb) in an idempotent way
-- Compatible with existing table: user_id BIGINT, data JSONB, updated_at TIMESTAMPTZ
-- Adds missing columns if needed; ensures index/trigger; migrates from legacy 'preferences'

BEGIN;

-- 1) Ensure table exists (BIGINT FK -> users.id), with minimal columns; add missing later
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id     bigint PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_preferences_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

-- 2) Add missing columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_preferences' AND column_name='created_at'
  ) THEN
    EXECUTE 'ALTER TABLE public.user_preferences ADD COLUMN created_at timestamptz NOT NULL DEFAULT now()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_preferences' AND column_name='updated_at'
  ) THEN
    EXECUTE 'ALTER TABLE public.user_preferences ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()';
  END IF;

  -- Ensure data has default '{}'
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_preferences' AND column_name='data'
  ) THEN
    EXECUTE 'ALTER TABLE public.user_preferences ALTER COLUMN data SET DEFAULT ''{}''::jsonb';
  END IF;
END$$;

-- 3) Ensure GIN index on data
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'user_preferences_data_gin' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'CREATE INDEX user_preferences_data_gin ON public.user_preferences USING GIN (data)';
  END IF;
END$$;

-- 4) Ensure BEFORE UPDATE trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION public.tg_user_prefs_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.tgname = 'tg_user_prefs_updated_at' AND c.relname = 'user_preferences' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'CREATE TRIGGER tg_user_prefs_updated_at
             BEFORE UPDATE ON public.user_preferences
             FOR EACH ROW EXECUTE FUNCTION public.tg_user_prefs_set_updated_at()';
  END IF;
END$$;

-- 5) Migrate from legacy 'preferences' if present (no reference to created_at here)
DO $$
DECLARE
  has_legacy boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='preferences'
  ) INTO has_legacy;

  IF has_legacy THEN
    EXECUTE $SQL$
      INSERT INTO public.user_preferences (user_id, data)
      SELECT
        p.user_id,
        jsonb_strip_nulls(
          '{}'::jsonb
          || CASE WHEN p.seen_color IS NOT NULL THEN jsonb_build_object('seen_color', p.seen_color) ELSE '{}'::jsonb END
          || CASE WHEN p.sort_col   IS NOT NULL THEN jsonb_build_object('sort_col',   p.sort_col)   ELSE '{}'::jsonb END
          || CASE WHEN p.sort_order IS NOT NULL THEN jsonb_build_object('sort_order', p.sort_order) ELSE '{}'::jsonb END
        )
      FROM public.preferences p
      WHERE p.user_id IS NOT NULL
      ON CONFLICT (user_id) DO UPDATE
        SET data = public.user_preferences.data || EXCLUDED.data,
            updated_at = now()
    $SQL$;
  END IF;
END$$;

COMMIT;
