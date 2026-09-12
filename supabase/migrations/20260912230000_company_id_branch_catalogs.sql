-- Batch 8: nullable company_id on next low-risk branch catalogs.
-- Dual-read: existing RLS unchanged; backfill + sync trigger only.

ALTER TABLE public.job_titles
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.job_titles t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_titles_company_id_idx ON public.job_titles (company_id);

ALTER TABLE public.break_settings
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.break_settings t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS break_settings_company_id_idx ON public.break_settings (company_id);

ALTER TABLE public.shift_definitions
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.shift_definitions t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS shift_definitions_company_id_idx ON public.shift_definitions (company_id);

ALTER TABLE public.shift_definition_day_hours
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.shift_definition_day_hours t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS shift_definition_day_hours_company_id_idx ON public.shift_definition_day_hours (company_id);

ALTER TABLE public.employee_of_month
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.employee_of_month t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS employee_of_month_company_id_idx ON public.employee_of_month (company_id);

-- Reuse sync_row_company_id_from_branch() from batch 7
DROP TRIGGER IF EXISTS trg_job_titles_sync_company ON public.job_titles;
CREATE TRIGGER trg_job_titles_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.job_titles
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

DROP TRIGGER IF EXISTS trg_break_settings_sync_company ON public.break_settings;
CREATE TRIGGER trg_break_settings_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.break_settings
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

DROP TRIGGER IF EXISTS trg_shift_definitions_sync_company ON public.shift_definitions;
CREATE TRIGGER trg_shift_definitions_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.shift_definitions
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

DROP TRIGGER IF EXISTS trg_shift_definition_day_hours_sync_company ON public.shift_definition_day_hours;
CREATE TRIGGER trg_shift_definition_day_hours_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.shift_definition_day_hours
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

DROP TRIGGER IF EXISTS trg_employee_of_month_sync_company ON public.employee_of_month;
CREATE TRIGGER trg_employee_of_month_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.employee_of_month
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();