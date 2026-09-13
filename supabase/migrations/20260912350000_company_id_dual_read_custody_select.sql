-- Batch 20: dual-read company_id on custody_* SELECT only.
-- SELECT-only. Roles / permission helpers / write policies / RESTRICTIVE ALL unchanged.
-- Style matches Batch 18/19: keep owner + CAB + custody perm gates; AND dual-read
-- onto the existing branch-scoped visibility arms only.
-- Canonical row scope ANDed onto those arms:
--   company_id IN (SELECT public.my_company_ids())
--   OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
-- is_platform_owner stays a top-level OR so owners are not gated by my_company_ids().

-- ---------------------------------------------------------------------------
-- custody_branch_settings SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS custody_branch_settings_select ON public.custody_branch_settings;
CREATE POLICY custody_branch_settings_select
ON public.custody_branch_settings
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR (
    branch_id = public.custody_effective_branch(auth.uid())
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- custody_item_types SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS custody_item_types_select ON public.custody_item_types;
CREATE POLICY custody_item_types_select
ON public.custody_item_types
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR (
    branch_id = public.custody_effective_branch(auth.uid())
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- custody_checkouts SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS custody_checkouts_select ON public.custody_checkouts;
CREATE POLICY custody_checkouts_select
ON public.custody_checkouts
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR (
    branch_id = public.custody_effective_branch(auth.uid())
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- custody_daily_entries SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS custody_daily_select ON public.custody_daily_entries;
CREATE POLICY custody_daily_select
ON public.custody_daily_entries
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR (
    branch_id = public.custody_effective_branch(auth.uid())
    AND (
      EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid() AND p.can_view_custody_daily_log = true
      )
      OR public.has_custody_create_perm(auth.uid())
      OR public.has_custody_edit_perm(auth.uid())
      OR public.has_custody_delete_perm(auth.uid())
      OR public.has_custody_configure_perm(auth.uid())
      OR public.has_custody_return_perm(auth.uid())
      OR public.has_custody_alert_perm(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid() AND p.can_run_custody_monthly_report = true
      )
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- custody_session_archive SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS custody_archive_select ON public.custody_session_archive;
CREATE POLICY custody_archive_select
ON public.custody_session_archive
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR (
    branch_id = public.custody_effective_branch(auth.uid())
    AND (
      public.has_custody_create_perm(auth.uid())
      OR public.has_custody_edit_perm(auth.uid())
      OR public.has_custody_delete_perm(auth.uid())
      OR public.has_custody_configure_perm(auth.uid())
      OR public.has_custody_return_perm(auth.uid())
      OR public.has_custody_alert_perm(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid() AND p.can_view_custody_daily_log = true
      )
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid() AND p.can_run_custody_monthly_report = true
      )
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- custody_monthly_reports SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS custody_reports_select ON public.custody_monthly_reports;
CREATE POLICY custody_reports_select
ON public.custody_monthly_reports
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR (
    branch_id = public.custody_effective_branch(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_task_permissions p
      WHERE p.user_id = auth.uid() AND p.can_run_custody_monthly_report = true
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- custody_audit_log SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS custody_audit_select ON public.custody_audit_log;
CREATE POLICY custody_audit_select
ON public.custody_audit_log
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR (
    branch_id = public.custody_effective_branch(auth.uid())
    AND (
      public.has_custody_create_perm(auth.uid())
      OR public.has_custody_edit_perm(auth.uid())
      OR public.has_custody_delete_perm(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid() AND p.can_view_custody_daily_log = true
      )
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);
