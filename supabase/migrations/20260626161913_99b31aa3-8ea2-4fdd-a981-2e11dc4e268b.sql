-- Fix schedules_insert: department_manager must match schedule's department_id
DROP POLICY IF EXISTS schedules_insert ON public.schedules;
CREATE POLICY schedules_insert ON public.schedules
FOR INSERT TO authenticated
WITH CHECK (
  has_schedule_create_perm(auth.uid())
  AND (
    has_role(auth.uid(), 'main_admin'::app_role)
    OR (
      has_role(auth.uid(), 'department_manager'::app_role)
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.department_id = schedules.department_id
      )
    )
    OR (
      (has_role(auth.uid(), 'branch_manager'::app_role) OR has_role(auth.uid(), 'assistant_manager'::app_role))
      AND EXISTS (
        SELECT 1 FROM public.user_task_permissions
        WHERE user_task_permissions.user_id = auth.uid()
          AND user_task_permissions.can_create_schedule = true
      )
    )
  )
);

-- Fix notif_insert: only privileged inserters; recipient must be a real schedule stakeholder
DROP POLICY IF EXISTS notif_insert ON public.schedule_notifications;
CREATE POLICY notif_insert ON public.schedule_notifications
FOR INSERT TO authenticated
WITH CHECK (
  (
    has_role(auth.uid(), 'main_admin'::app_role)
    OR has_schedule_approve_perm(auth.uid())
    OR has_schedule_publish_perm(auth.uid())
    OR (
      has_role(auth.uid(), 'department_manager'::app_role)
      AND EXISTS (
        SELECT 1 FROM public.schedules s
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE s.id = schedule_notifications.schedule_id
          AND s.department_id = p.department_id
      )
    )
  )
  AND EXISTS (
    SELECT 1 FROM public.schedules s
    JOIN public.profiles p ON p.id = schedule_notifications.user_id
    WHERE s.id = schedule_notifications.schedule_id
      AND (
        p.department_id = s.department_id
        OR has_role(p.id, 'main_admin'::app_role)
        OR has_role(p.id, 'branch_manager'::app_role)
        OR has_role(p.id, 'assistant_manager'::app_role)
      )
  )
);