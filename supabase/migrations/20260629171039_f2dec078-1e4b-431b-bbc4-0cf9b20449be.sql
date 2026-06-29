DROP POLICY IF EXISTS schedules_select ON public.schedules;
CREATE POLICY schedules_select ON public.schedules
FOR SELECT
USING (
  public.has_role(auth.uid(), 'main_admin'::public.app_role)
  OR public.has_schedule_approve_perm(auth.uid())
  OR public.has_schedule_publish_perm(auth.uid())
  OR schedules.created_by = auth.uid()
  OR (
    public.has_role(auth.uid(), 'department_manager'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.department_id = schedules.department_id
    )
    AND schedules.status = 'approved'::public.schedule_status
    AND schedules.published_at IS NOT NULL
  )
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
        public.has_role(auth.uid(), 'main_admin'::public.app_role)
        OR public.has_schedule_approve_perm(auth.uid())
        OR public.has_schedule_publish_perm(auth.uid())
        OR s.created_by = auth.uid()
        OR (
          public.has_role(auth.uid(), 'department_manager'::public.app_role)
          AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.department_id = s.department_id
          )
          AND s.status = 'approved'::public.schedule_status
          AND s.published_at IS NOT NULL
        )
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