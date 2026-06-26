
DROP POLICY IF EXISTS schedules_update ON public.schedules;
CREATE POLICY schedules_update ON public.schedules
FOR UPDATE
USING (
  public.has_role(auth.uid(),'main_admin')
  OR public.has_schedule_approve_perm(auth.uid())
  OR public.has_schedule_publish_perm(auth.uid())
  OR (public.has_role(auth.uid(),'department_manager')
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = schedules.department_id)
      AND status = ANY (ARRAY['draft'::schedule_status,'rejected'::schedule_status,'pending_approval'::schedule_status]))
)
WITH CHECK (
  public.has_role(auth.uid(),'main_admin')
  OR public.has_schedule_approve_perm(auth.uid())
  OR public.has_schedule_publish_perm(auth.uid())
  OR (public.has_role(auth.uid(),'department_manager')
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = schedules.department_id))
);
