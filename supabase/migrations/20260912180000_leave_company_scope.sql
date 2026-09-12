-- Batch 3: upgrade leave_* RESTRICTIVE branch scopes from current_active_branch-only
-- to company-aware via public.branch_in_my_companies(uuid) (live from 20260912170000).
-- Also replace permissive leave_types_select / leave_accrual_select USING (true)
-- with explicit company-scope SELECT. Platform-owner bypass is kept.
-- Does not add company_id columns.

-- ---------------------------------------------------------------------------
-- Restrictive branch scopes → company-aware
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS leave_types_branch_scope ON public.leave_types;
CREATE POLICY leave_types_branch_scope ON public.leave_types AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

DROP POLICY IF EXISTS leave_accrual_branch_scope ON public.leave_accrual_rules;
CREATE POLICY leave_accrual_branch_scope ON public.leave_accrual_rules AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

DROP POLICY IF EXISTS leave_balances_branch_scope ON public.leave_balances;
CREATE POLICY leave_balances_branch_scope ON public.leave_balances AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

DROP POLICY IF EXISTS leave_adj_branch_scope ON public.leave_balance_adjustments;
CREATE POLICY leave_adj_branch_scope ON public.leave_balance_adjustments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

DROP POLICY IF EXISTS leave_requests_branch_scope ON public.leave_requests;
CREATE POLICY leave_requests_branch_scope ON public.leave_requests AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

DROP POLICY IF EXISTS leave_attach_branch_scope ON public.leave_request_attachments;
CREATE POLICY leave_attach_branch_scope ON public.leave_request_attachments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

DROP POLICY IF EXISTS leave_audit_branch_scope ON public.leave_audit_log;
CREATE POLICY leave_audit_branch_scope ON public.leave_audit_log AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NULL
    OR public.branch_in_my_companies(branch_id)
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NULL
    OR public.branch_in_my_companies(branch_id)
  );

-- ---------------------------------------------------------------------------
-- Permissive SELECT catalogs → explicit company scope
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS leave_types_select ON public.leave_types;
DROP POLICY IF EXISTS leave_types_select_scoped ON public.leave_types;
CREATE POLICY leave_types_select_scoped
  ON public.leave_types
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

DROP POLICY IF EXISTS leave_accrual_select ON public.leave_accrual_rules;
DROP POLICY IF EXISTS leave_accrual_select_scoped ON public.leave_accrual_rules;
CREATE POLICY leave_accrual_select_scoped
  ON public.leave_accrual_rules
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );
