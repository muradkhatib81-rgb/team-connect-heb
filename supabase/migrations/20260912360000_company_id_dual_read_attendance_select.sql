-- Batch 21: dual-read company_id on attendance (+ optional breaks) SELECT only.
-- SELECT-only. Roles / permission helpers / write policies unchanged.
-- Choice (documented): do NOT modify SECURITY DEFINER attendance_can_see_session.
-- Recreate attendance_sessions_select duplicating safe gates from the helper
-- (platform owner + self + same-branch grant) and AND dual-read only on the
-- grant/visibility arm. attendance_user_grants stays owner-only ALL (untouched).
-- Canonical dual-read:
--   company_id IN (SELECT public.my_company_ids())
--   OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
-- is_platform_owner stays a top-level OR so owners are not gated by my_company_ids().

-- ---------------------------------------------------------------------------
-- attendance_sessions SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS attendance_sessions_select ON public.attendance_sessions;
CREATE POLICY attendance_sessions_select
ON public.attendance_sessions
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR user_id = auth.uid()
  OR (
    EXISTS (
      SELECT 1
      FROM public.attendance_user_grants g
      WHERE g.user_id = auth.uid()
        AND g.branch_id = attendance_sessions.branch_id
        AND (g.can_view OR g.can_edit OR g.can_delete)
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- attendance_user_grants: intentionally NOT changed (owner-only ALL).

-- ---------------------------------------------------------------------------
-- Batch 21b (optional low-risk): break_requests / break_audit_log SELECT
-- Keep self SELECT; AND dual-read only on manager/admin visibility arms.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Break managers view all" ON public.break_requests;
CREATE POLICY "Break managers view all"
ON public.break_requests
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR (
    public.has_break_manage_perm(auth.uid())
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- "Users view their own break requests" (user_id = auth.uid()) left unchanged.

DROP POLICY IF EXISTS "Break audit managers view" ON public.break_audit_log;
CREATE POLICY "Break audit managers view"
ON public.break_audit_log
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR (
    (
      public.has_role(auth.uid(), 'system_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
      OR EXISTS (
        SELECT 1
        FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid()
          AND p.can_manage_breaks = true
      )
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);
