-- Batch 10: nullable company_id on settings/break requests/management_on_shift.
-- Dual-read; RLS unchanged. Reuses sync_row_company_id_from_branch().

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.company_settings AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS company_settings_company_id_idx ON public.company_settings (company_id);
DROP TRIGGER IF EXISTS trg_company_settings_sync_company ON public.company_settings;
CREATE TRIGGER trg_company_settings_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.break_requests
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.break_requests AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS break_requests_company_id_idx ON public.break_requests (company_id);
DROP TRIGGER IF EXISTS trg_break_requests_sync_company ON public.break_requests;
CREATE TRIGGER trg_break_requests_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.break_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.break_audit_log
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.break_audit_log AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS break_audit_log_company_id_idx ON public.break_audit_log (company_id);
DROP TRIGGER IF EXISTS trg_break_audit_log_sync_company ON public.break_audit_log;
CREATE TRIGGER trg_break_audit_log_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.break_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.management_on_shift
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.management_on_shift AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS management_on_shift_company_id_idx ON public.management_on_shift (company_id);
DROP TRIGGER IF EXISTS trg_management_on_shift_sync_company ON public.management_on_shift;
CREATE TRIGGER trg_management_on_shift_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.management_on_shift
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

