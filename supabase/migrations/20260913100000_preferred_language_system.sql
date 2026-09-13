-- Allow profiles.preferred_language = system (follow OS locale).
-- Do NOT rewrite existing he/ar/en rows.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_preferred_language_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_language_check
  CHECK (preferred_language IN ('he', 'ar', 'en', 'system'));

ALTER TABLE public.profiles
  ALTER COLUMN preferred_language SET DEFAULT 'system';

COMMENT ON COLUMN public.profiles.preferred_language IS
  'User interface language preference (he/ar/en/system). system follows OS locale.';
