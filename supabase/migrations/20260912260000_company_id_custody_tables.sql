-- Batch 11: nullable company_id on custody_* tables (dual-read; RLS unchanged).
-- Reuses sync_row_company_id_from_branch().

ALTER TABLE public.custody_branch_settings
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.custody_branch_settings AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS custody_branch_settings_company_id_idx ON public.custody_branch_settings (company_id);
DROP TRIGGER IF EXISTS trg_custody_branch_settings_sync_company ON public.custody_branch_settings;
CREATE TRIGGER trg_custody_branch_settings_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.custody_branch_settings
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.custody_item_types
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.custody_item_types AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS custody_item_types_company_id_idx ON public.custody_item_types (company_id);
DROP TRIGGER IF EXISTS trg_custody_item_types_sync_company ON public.custody_item_types;
CREATE TRIGGER trg_custody_item_types_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.custody_item_types
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.custody_daily_entries
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.custody_daily_entries AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS custody_daily_entries_company_id_idx ON public.custody_daily_entries (company_id);
DROP TRIGGER IF EXISTS trg_custody_daily_entries_sync_company ON public.custody_daily_entries;
CREATE TRIGGER trg_custody_daily_entries_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.custody_daily_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.custody_checkouts
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.custody_checkouts AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS custody_checkouts_company_id_idx ON public.custody_checkouts (company_id);
DROP TRIGGER IF EXISTS trg_custody_checkouts_sync_company ON public.custody_checkouts;
CREATE TRIGGER trg_custody_checkouts_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.custody_checkouts
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.custody_monthly_reports
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.custody_monthly_reports AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS custody_monthly_reports_company_id_idx ON public.custody_monthly_reports (company_id);
DROP TRIGGER IF EXISTS trg_custody_monthly_reports_sync_company ON public.custody_monthly_reports;
CREATE TRIGGER trg_custody_monthly_reports_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.custody_monthly_reports
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.custody_session_archive
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.custody_session_archive AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS custody_session_archive_company_id_idx ON public.custody_session_archive (company_id);
DROP TRIGGER IF EXISTS trg_custody_session_archive_sync_company ON public.custody_session_archive;
CREATE TRIGGER trg_custody_session_archive_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.custody_session_archive
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.custody_audit_log
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.custody_audit_log AS t
SET company_id = public.company_id_of_branch(t.branch_id)
WHERE t.company_id IS NULL AND t.branch_id IS NOT NULL
  AND public.company_id_of_branch(t.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS custody_audit_log_company_id_idx ON public.custody_audit_log (company_id);
DROP TRIGGER IF EXISTS trg_custody_audit_log_sync_company ON public.custody_audit_log;
CREATE TRIGGER trg_custody_audit_log_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.custody_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

