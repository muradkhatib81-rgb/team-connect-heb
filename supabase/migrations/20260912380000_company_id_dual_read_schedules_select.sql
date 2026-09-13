-- Batch 23: dual-read company_id on schedules / schedule_shifts / schedule_audit_log SELECT.
-- SELECT-only. Roles / permission helpers / write policies / RESTRICTIVE dept
-- scopes unchanged (dept RESTRICTIVE already scopes without company dual-read;
-- not required here and would risk narrowing employee published views if combined wrong).
-- Style: keep same-department published employee arm; AND dual-read only on
-- role/perm manager/admin visibility arms. is_platform_owner top-level OR.
-- schedule_notifications: SKIPPED — remains self-only (user_id = auth.uid()).
-- Canonical dual-read:
--   company_id IN (SELECT public.my_company_ids())
--   OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))

-- ---------------------------------------------------------------------------
-- schedules SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS schedules_select ON public.schedules;
CREATE POLICY schedules_select
ON public.schedules
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.department_id = schedules.department_id
      AND schedules.status = 'approved'::public.schedule_status
      AND schedules.published_at IS NOT NULL
  )
  OR (
    (
      public.has_role(auth.uid(), 'system_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
      OR public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
      OR public.has_schedule_create_perm(auth.uid())
      OR public.has_schedule_approve_perm(auth.uid())
      OR public.has_schedule_publish_perm(auth.uid())
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- schedule_shifts SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS shifts_select ON public.schedule_shifts;
CREATE POLICY shifts_select
ON public.schedule_shifts
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.schedules s
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE s.id = schedule_shifts.schedule_id
      AND p.department_id = s.department_id
      AND s.status = 'approved'::public.schedule_status
      AND s.published_at IS NOT NULL
  )
  OR (
    EXISTS (
      SELECT 1
      FROM public.schedules s
      WHERE s.id = schedule_shifts.schedule_id
        AND (
          public.has_role(auth.uid(), 'system_admin'::public.app_role)
          OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
          OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
          OR public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
          OR public.has_schedule_create_perm(auth.uid())
          OR public.has_schedule_approve_perm(auth.uid())
          OR public.has_schedule_publish_perm(auth.uid())
        )
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- schedule_audit_log SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_select ON public.schedule_audit_log;
CREATE POLICY audit_select
ON public.schedule_audit_log
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.schedules s
    WHERE s.id = schedule_audit_log.schedule_id
      AND public.has_role(auth.uid(), 'department_manager'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.department_id = s.department_id
      )
  )
  OR (
    EXISTS (
      SELECT 1
      FROM public.schedules s
      WHERE s.id = schedule_audit_log.schedule_id
        AND (
          public.has_role(auth.uid(), 'main_admin'::public.app_role)
          OR public.has_schedule_approve_perm(auth.uid())
        )
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- schedule_notifications (notif_select): intentionally SKIPPED — keep
-- USING (user_id = auth.uid()) so own notifications are never hidden by
-- empty my_company_ids() / null company_id edge cases.
