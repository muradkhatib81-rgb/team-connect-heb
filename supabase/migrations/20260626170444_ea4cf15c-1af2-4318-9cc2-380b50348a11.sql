
-- Allow main_admin and users with publish perm to edit shifts on any status (including approved)
DROP POLICY IF EXISTS shifts_write ON public.schedule_shifts;
CREATE POLICY shifts_write ON public.schedule_shifts
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_shifts.schedule_id
    AND (
      public.has_role(auth.uid(), 'main_admin'::app_role)
      OR public.has_schedule_publish_perm(auth.uid())
      OR (
        public.has_role(auth.uid(), 'department_manager'::app_role)
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = s.department_id)
        AND s.status = ANY (ARRAY['draft'::schedule_status, 'rejected'::schedule_status])
      )
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_shifts.schedule_id
    AND (
      public.has_role(auth.uid(), 'main_admin'::app_role)
      OR public.has_schedule_publish_perm(auth.uid())
      OR (
        public.has_role(auth.uid(), 'department_manager'::app_role)
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = s.department_id)
        AND s.status = ANY (ARRAY['draft'::schedule_status, 'rejected'::schedule_status])
      )
    )
  )
);
