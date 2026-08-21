-- Monthly schedule: which days of week appear in the grid (e.g. exclude Friday).

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS monthly_working_dows smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}';

COMMENT ON COLUMN public.company_settings.monthly_working_dows IS
  'For monthly schedules: days of week included in grid. 0=Saturday … 6=Friday.';

NOTIFY pgrst, 'reload schema';
