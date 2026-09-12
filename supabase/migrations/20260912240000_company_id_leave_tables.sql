-- Batch 9: nullable company_id on leave_* tables (dual-read; RLS unchanged).
-- Reuses public.sync_row_company_id_from_branch() from batch 7.

ALTER TABLE public.leave_types
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.leave_types row
SET company_id = public.company_id_of_branch(row.branch_id)
WHERE row.company_id IS NULL AND row.branch_id IS NOT NULL
  AND public.company_id_of_branch(row.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_types_company_id_idx ON public.leave_types (company_id);
DROP TRIGGER IF EXISTS trg_leave_types_sync_company ON public.leave_types;
CREATE TRIGGER trg_leave_types_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.leave_types
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.leave_accrual_rules
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.leave_accrual_rules row
SET company_id = public.company_id_of_branch(row.branch_id)
WHERE row.company_id IS NULL AND row.branch_id IS NOT NULL
  AND public.company_id_of_branch(row.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_accrual_rules_company_id_idx ON public.leave_accrual_rules (company_id);
DROP TRIGGER IF EXISTS trg_leave_accrual_rules_sync_company ON public.leave_accrual_rules;
CREATE TRIGGER trg_leave_accrual_rules_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.leave_accrual_rules
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.leave_balances
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.leave_balances row
SET company_id = public.company_id_of_branch(row.branch_id)
WHERE row.company_id IS NULL AND row.branch_id IS NOT NULL
  AND public.company_id_of_branch(row.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_balances_company_id_idx ON public.leave_balances (company_id);
DROP TRIGGER IF EXISTS trg_leave_balances_sync_company ON public.leave_balances;
CREATE TRIGGER trg_leave_balances_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.leave_balances
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.leave_balance_adjustments
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.leave_balance_adjustments row
SET company_id = public.company_id_of_branch(row.branch_id)
WHERE row.company_id IS NULL AND row.branch_id IS NOT NULL
  AND public.company_id_of_branch(row.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_balance_adjustments_company_id_idx ON public.leave_balance_adjustments (company_id);
DROP TRIGGER IF EXISTS trg_leave_balance_adjustments_sync_company ON public.leave_balance_adjustments;
CREATE TRIGGER trg_leave_balance_adjustments_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.leave_balance_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.leave_employee_accrual_rates
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.leave_employee_accrual_rates row
SET company_id = public.company_id_of_branch(row.branch_id)
WHERE row.company_id IS NULL AND row.branch_id IS NOT NULL
  AND public.company_id_of_branch(row.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_employee_accrual_rates_company_id_idx ON public.leave_employee_accrual_rates (company_id);
DROP TRIGGER IF EXISTS trg_leave_employee_accrual_rates_sync_company ON public.leave_employee_accrual_rates;
CREATE TRIGGER trg_leave_employee_accrual_rates_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.leave_employee_accrual_rates
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.leave_requests row
SET company_id = public.company_id_of_branch(row.branch_id)
WHERE row.company_id IS NULL AND row.branch_id IS NOT NULL
  AND public.company_id_of_branch(row.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_requests_company_id_idx ON public.leave_requests (company_id);
DROP TRIGGER IF EXISTS trg_leave_requests_sync_company ON public.leave_requests;
CREATE TRIGGER trg_leave_requests_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.leave_request_attachments
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.leave_request_attachments row
SET company_id = public.company_id_of_branch(row.branch_id)
WHERE row.company_id IS NULL AND row.branch_id IS NOT NULL
  AND public.company_id_of_branch(row.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_request_attachments_company_id_idx ON public.leave_request_attachments (company_id);
DROP TRIGGER IF EXISTS trg_leave_request_attachments_sync_company ON public.leave_request_attachments;
CREATE TRIGGER trg_leave_request_attachments_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.leave_request_attachments
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

ALTER TABLE public.leave_audit_log
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
UPDATE public.leave_audit_log row
SET company_id = public.company_id_of_branch(row.branch_id)
WHERE row.company_id IS NULL AND row.branch_id IS NOT NULL
  AND public.company_id_of_branch(row.branch_id) IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_audit_log_company_id_idx ON public.leave_audit_log (company_id);
DROP TRIGGER IF EXISTS trg_leave_audit_log_sync_company ON public.leave_audit_log;
CREATE TRIGGER trg_leave_audit_log_sync_company
  BEFORE INSERT OR UPDATE OF branch_id ON public.leave_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_row_company_id_from_branch();

