
-- Fix 1: Allow Branch Managers to create schedules by role alone
-- (do not require a user_task_permissions.can_create_schedule row).
DROP POLICY IF EXISTS schedules_insert ON public.schedules;
CREATE POLICY schedules_insert ON public.schedules
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_schedule_create_perm(auth.uid())
    AND (
      public.has_role(auth.uid(), 'main_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
      OR (
        public.has_role(auth.uid(), 'department_manager'::public.app_role)
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.department_id = schedules.department_id
        )
      )
      OR (
        public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
        AND EXISTS (
          SELECT 1 FROM public.user_task_permissions
          WHERE user_id = auth.uid() AND can_create_schedule = true
        )
      )
    )
  );

-- Also ensure Branch Managers can update schedules directly by role
-- (in case has_schedule_publish_perm is ever narrowed). The current
-- policy already lets BM through via has_schedule_publish_perm, but
-- adding an explicit role clause makes intent clear and future-proof.
DROP POLICY IF EXISTS schedules_update ON public.schedules;
CREATE POLICY schedules_update ON public.schedules
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR public.has_schedule_approve_perm(auth.uid())
    OR public.has_schedule_publish_perm(auth.uid())
    OR (
      public.has_role(auth.uid(), 'department_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.department_id = schedules.department_id
      )
      AND status = ANY (ARRAY['draft'::schedule_status,'rejected'::schedule_status,'pending_approval'::schedule_status])
    )
    OR (created_by = auth.uid()
        AND status = ANY (ARRAY['draft'::schedule_status,'rejected'::schedule_status]))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR public.has_schedule_approve_perm(auth.uid())
    OR public.has_schedule_publish_perm(auth.uid())
    OR (
      public.has_role(auth.uid(), 'department_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.department_id = schedules.department_id
      )
      AND status = ANY (ARRAY['draft'::schedule_status,'rejected'::schedule_status,'pending_approval'::schedule_status])
    )
    OR (created_by = auth.uid()
        AND status = ANY (ARRAY['draft'::schedule_status,'rejected'::schedule_status,'pending_approval'::schedule_status]))
  );

-- Fix 2: Allow Branch Managers to manage job titles (break-request
-- permissions toggle etc.) for their own branch only. Main admin
-- policies remain untouched.
CREATE POLICY "Branch managers can update job titles"
  ON public.job_titles
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    AND branch_id = public.current_active_branch()
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    AND branch_id = public.current_active_branch()
  );

CREATE POLICY "Branch managers can insert job titles"
  ON public.job_titles
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    AND (branch_id IS NULL OR branch_id = public.current_active_branch())
  );

CREATE POLICY "Branch managers can delete job titles"
  ON public.job_titles
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    AND branch_id = public.current_active_branch()
  );
