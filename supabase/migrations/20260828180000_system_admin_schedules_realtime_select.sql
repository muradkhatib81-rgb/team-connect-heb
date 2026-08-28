-- Platform owners (system_admin) can publish schedules in app code but were missing
-- from schedules SELECT RLS, so Supabase Realtime never delivered postgres_changes.

DROP POLICY IF EXISTS schedules_select ON public.schedules;
CREATE POLICY schedules_select ON public.schedules
FOR SELECT
USING (
  public.has_role(auth.uid(), 'system_admin'::public.app_role)
  OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
  OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
  OR public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
  OR public.has_schedule_create_perm(auth.uid())
  OR public.has_schedule_approve_perm(auth.uid())
  OR public.has_schedule_publish_perm(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.department_id = schedules.department_id
      AND schedules.status = 'approved'::public.schedule_status
      AND schedules.published_at IS NOT NULL
  )
);

DROP POLICY IF EXISTS shifts_select ON public.schedule_shifts;
CREATE POLICY shifts_select ON public.schedule_shifts
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_shifts.schedule_id
      AND (
        public.has_role(auth.uid(), 'system_admin'::public.app_role)
        OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
        OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
        OR public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
        OR public.has_schedule_create_perm(auth.uid())
        OR public.has_schedule_approve_perm(auth.uid())
        OR public.has_schedule_publish_perm(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.department_id = s.department_id
            AND s.status = 'approved'::public.schedule_status
            AND s.published_at IS NOT NULL
        )
      )
  )
);
