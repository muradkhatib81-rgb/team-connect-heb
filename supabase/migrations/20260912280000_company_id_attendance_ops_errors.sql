-- Batch 13: nullable company_id on attendance + ops_error tables (dual-read; RLS unchanged).
-- Reuses sync_row_company_id_from_branch().

ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.attendance_sessions AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_sessions_company_id_idx ON public.attendance_sessions (company_id);
DROP TRIGGER IF EXISTS trg_attendance_sessions_sync_company ON public.attendance_sessions;
CREATE TRIGGER trg_attendance_sessions_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.attendance_user_grants
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.attendance_user_grants AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_user_grants_company_id_idx ON public.attendance_user_grants (company_id);
DROP TRIGGER IF EXISTS trg_attendance_user_grants_sync_company ON public.attendance_user_grants;
CREATE TRIGGER trg_attendance_user_grants_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.attendance_user_grants
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.ops_error_entries
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.ops_error_entries AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_error_entries_company_id_idx ON public.ops_error_entries (company_id);
DROP TRIGGER IF EXISTS trg_ops_error_entries_sync_company ON public.ops_error_entries;
CREATE TRIGGER trg_ops_error_entries_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.ops_error_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.ops_error_month_archives
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.ops_error_month_archives AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_error_month_archives_company_id_idx ON public.ops_error_month_archives (company_id);
DROP TRIGGER IF EXISTS trg_ops_error_month_archives_sync_company ON public.ops_error_month_archives;
CREATE TRIGGER trg_ops_error_month_archives_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.ops_error_month_archives
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.ops_error_user_grants
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.ops_error_user_grants AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_error_user_grants_company_id_idx ON public.ops_error_user_grants (company_id);
DROP TRIGGER IF EXISTS trg_ops_error_user_grants_sync_company ON public.ops_error_user_grants;
CREATE TRIGGER trg_ops_error_user_grants_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.ops_error_user_grants
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

