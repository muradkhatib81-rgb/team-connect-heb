DROP POLICY IF EXISTS schedules_update ON public.schedules;
CREATE POLICY schedules_update ON public.schedules FOR UPDATE
USING (
  has_role(auth.uid(), 'main_admin'::app_role)
  OR has_schedule_approve_perm(auth.uid())
  OR (
    has_role(auth.uid(), 'department_manager'::app_role)
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.department_id = schedules.department_id)
    AND status = ANY (ARRAY['draft'::schedule_status, 'rejected'::schedule_status, 'pending_approval'::schedule_status])
  )
)
WITH CHECK (
  has_role(auth.uid(), 'main_admin'::app_role)
  OR has_schedule_approve_perm(auth.uid())
  OR (
    has_role(auth.uid(), 'department_manager'::app_role)
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.department_id = schedules.department_id)
  )
);