DROP POLICY IF EXISTS schedules_delete ON public.schedules;
CREATE POLICY schedules_delete ON public.schedules
FOR DELETE
USING (
  public.has_role(auth.uid(), 'main_admin'::public.app_role)
  OR public.has_schedule_publish_perm(auth.uid())
  OR public.has_schedule_approve_perm(auth.uid())
  OR (
    public.has_role(auth.uid(), 'department_manager'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.department_id = schedules.department_id
    )
    AND status = ANY (ARRAY['draft'::public.schedule_status, 'rejected'::public.schedule_status])
  )
);