DROP POLICY IF EXISTS shifts_write ON public.schedule_shifts;

CREATE POLICY shifts_write ON public.schedule_shifts
AS PERMISSIVE FOR ALL
TO public
USING (
  EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_shifts.schedule_id
      AND (
        public.has_role(auth.uid(),'main_admin')
        OR public.has_schedule_publish_perm(auth.uid())
        OR (public.has_schedule_approve_perm(auth.uid()) AND s.status = 'pending_approval'::public.schedule_status)
        OR (
          public.has_role(auth.uid(),'department_manager')
          AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = s.department_id)
          AND s.status = ANY (ARRAY['draft'::public.schedule_status,'rejected'::public.schedule_status])
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_shifts.schedule_id
      AND (
        public.has_role(auth.uid(),'main_admin')
        OR public.has_schedule_publish_perm(auth.uid())
        OR (public.has_schedule_approve_perm(auth.uid()) AND s.status = 'pending_approval'::public.schedule_status)
        OR (
          public.has_role(auth.uid(),'department_manager')
          AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = s.department_id)
          AND s.status = ANY (ARRAY['draft'::public.schedule_status,'rejected'::public.schedule_status])
        )
      )
  )
);