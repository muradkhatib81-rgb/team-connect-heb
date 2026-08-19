-- Persist UI language preference and cache AI translations for user-generated content.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'he'
  CHECK (preferred_language IN ('he', 'ar', 'en'));

COMMENT ON COLUMN public.profiles.preferred_language IS
  'User interface language (he/ar/en). Synced from the language switcher.';

CREATE TABLE IF NOT EXISTS public.content_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('message', 'morning_board_item', 'task', 'task_comment')),
  entity_id uuid NOT NULL,
  field_name text NOT NULL CHECK (field_name IN ('title', 'body', 'description')),
  source_lang text NOT NULL CHECK (source_lang IN ('he', 'ar', 'en')),
  target_lang text NOT NULL CHECK (target_lang IN ('he', 'ar', 'en')),
  source_hash text NOT NULL,
  translated_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_translations_unique
    UNIQUE (entity_type, entity_id, field_name, target_lang, source_hash)
);

CREATE INDEX IF NOT EXISTS content_translations_lookup_idx
  ON public.content_translations (entity_type, entity_id, field_name, target_lang);

ALTER TABLE public.content_translations ENABLE ROW LEVEL SECURITY;

-- No authenticated policies: translations are read/written only via service-role server functions.
