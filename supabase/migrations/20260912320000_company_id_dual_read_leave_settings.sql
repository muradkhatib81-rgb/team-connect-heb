-- Batch 17: dual-read company_id on leave SELECT + RESTRICTIVE scopes + company_settings SELECT.
-- leave_emp_accrual: upgrade CAB → company-aware dual-read (same form as other leave scopes).
-- Permissive role/permission policies unchanged.

-- ---------------------------------------------------------------------------
-- leave_* SELECT catalogs
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS leave_types_select_scoped ON public.leave_types;
CREATE POLICY leave_types_select_scoped
  ON public.leave_types FOR SELECT TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS leave_accrual_select_scoped ON public.leave_accrual_rules;
CREATE POLICY leave_accrual_select_scoped
  ON public.leave_accrual_rules FOR SELECT TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

-- ---------------------------------------------------------------------------
-- leave_* RESTRICTIVE ALL → dual-read
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS leave_types_branch_scope ON public.leave_types;
CREATE POLICY leave_types_branch_scope ON public.leave_types AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS leave_accrual_branch_scope ON public.leave_accrual_rules;
CREATE POLICY leave_accrual_branch_scope ON public.leave_accrual_rules AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS leave_balances_branch_scope ON public.leave_balances;
CREATE POLICY leave_balances_branch_scope ON public.leave_balances AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS leave_adj_branch_scope ON public.leave_balance_adjustments;
CREATE POLICY leave_adj_branch_scope ON public.leave_balance_adjustments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS leave_emp_accrual_branch_scope ON public.leave_employee_accrual_rates;
CREATE POLICY leave_emp_accrual_branch_scope ON public.leave_employee_accrual_rates AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS leave_requests_branch_scope ON public.leave_requests;
CREATE POLICY leave_requests_branch_scope ON public.leave_requests AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS leave_attach_branch_scope ON public.leave_request_attachments;
CREATE POLICY leave_attach_branch_scope ON public.leave_request_attachments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS leave_audit_branch_scope ON public.leave_audit_log;
CREATE POLICY leave_audit_branch_scope ON public.leave_audit_log AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NULL
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NULL
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

-- ---------------------------------------------------------------------------
-- company_settings SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS company_settings_select_scoped ON public.company_settings;
CREATE POLICY company_settings_select_scoped
  ON public.company_settings FOR SELECT TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );
