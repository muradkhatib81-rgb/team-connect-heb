-- Batch 15 (final dual-read): nullable company_id on identity tables.
-- profiles, departments, employee_archive, profile_status_log.
-- Reuses sync_row_company_id_from_branch(). RLS unchanged.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.profiles AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_company_id_idx ON public.profiles (company_id);
DROP TRIGGER IF EXISTS trg_profiles_sync_company ON public.profiles;
CREATE TRIGGER trg_profiles_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.departments AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS departments_company_id_idx ON public.departments (company_id);
DROP TRIGGER IF EXISTS trg_departments_sync_company ON public.departments;
CREATE TRIGGER trg_departments_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.employee_archive
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.employee_archive AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS employee_archive_company_id_idx ON public.employee_archive (company_id);
DROP TRIGGER IF EXISTS trg_employee_archive_sync_company ON public.employee_archive;
CREATE TRIGGER trg_employee_archive_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.employee_archive
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.profile_status_log
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.profile_status_log AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS profile_status_log_company_id_idx ON public.profile_status_log (company_id);
DROP TRIGGER IF EXISTS trg_profile_status_log_sync_company ON public.profile_status_log;
CREATE TRIGGER trg_profile_status_log_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.profile_status_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();