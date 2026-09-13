-- Batch 22: dual-read company_id on tasks / task_recurrences / task_activity_log SELECT.
-- SELECT-only. Roles / permission helpers / write policies unchanged.
-- Style matches Batch 19: keep self/assignee/dept gates; AND dual-read only on
-- manager/admin (and broadcast all_departments) visibility arms.
-- Canonical dual-read:
--   company_id IN (SELECT public.my_company_ids())
--   OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
-- is_platform_owner stays a top-level OR.
-- can_view_task helper is NOT modified (SECURITY DEFINER); activity SELECT
-- recreates the same arm split at policy level.

-- ---------------------------------------------------------------------------
-- tasks SELECT ("Task visibility")
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Task visibility" ON public.tasks;
CREATE POLICY "Task visibility"
ON public.tasks
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR created_by = auth.uid()
  OR assignee_id = auth.uid()
  OR public.user_is_task_assignee(id, auth.uid())
  OR department_id IN (
    SELECT d.id FROM public.departments d WHERE d.manager_id = auth.uid()
  )
  OR department_id = (
    SELECT p.department_id FROM public.profiles p WHERE p.id = auth.uid()
  )
  OR public.user_shares_task_department(id, auth.uid())
  OR (
    (
      public.has_task_edit_perm(auth.uid())
      OR public.is_admin(auth.uid())
      OR target_scope = 'all_departments'::public.task_target_scope
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- task_recurrences SELECT ("Recurrence visibility")
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Recurrence visibility" ON public.task_recurrences;
CREATE POLICY "Recurrence visibility"
ON public.task_recurrences
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR department_id IN (
    SELECT id FROM public.departments WHERE manager_id = auth.uid()
  )
  OR department_id = (
    SELECT department_id FROM public.profiles WHERE id = auth.uid()
  )
  OR (
    (
      public.has_task_management_perm(auth.uid())
      OR public.is_admin(auth.uid())
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- task_activity_log SELECT
-- Mirror Task visibility arms via join; dual-read on admin/broadcast only.
-- Uses activity row company_id/branch_id (synced from task branch).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS task_activity_select ON public.task_activity_log;
CREATE POLICY task_activity_select
ON public.task_activity_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_activity_log.task_id
      AND (
        public.is_platform_owner(auth.uid())
        OR t.created_by = auth.uid()
        OR t.assignee_id = auth.uid()
        OR public.user_is_task_assignee(t.id, auth.uid())
        OR t.department_id IN (
          SELECT d.id FROM public.departments d WHERE d.manager_id = auth.uid()
        )
        OR t.department_id = (
          SELECT p.department_id FROM public.profiles p WHERE p.id = auth.uid()
        )
        OR public.user_shares_task_department(t.id, auth.uid())
        OR (
          (
            public.has_task_edit_perm(auth.uid())
            OR public.is_admin(auth.uid())
            OR t.target_scope = 'all_departments'::public.task_target_scope
          )
          AND (
            task_activity_log.company_id IN (SELECT public.my_company_ids())
            OR (
              task_activity_log.company_id IS NULL
              AND public.branch_in_my_companies(task_activity_log.branch_id)
            )
          )
        )
      )
  )
);
