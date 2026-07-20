-- Allow platform owners and custody log viewers to read session archive / daily entries
-- when browsing a branch from the dashboard (without relying on x-active-branch header).

DROP POLICY IF EXISTS custody_archive_select ON public.custody_session_archive;
CREATE POLICY custody_archive_select ON public.custody_session_archive
  FOR SELECT TO authenticated
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
    )
  );

DROP POLICY IF EXISTS custody_daily_select ON public.custody_daily_entries;
CREATE POLICY custody_daily_select ON public.custody_daily_entries
  FOR SELECT TO authenticated
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
    )
  );
