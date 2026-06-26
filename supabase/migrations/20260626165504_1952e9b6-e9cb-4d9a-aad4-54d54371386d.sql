DROP POLICY IF EXISTS "Authenticated can view task permissions" ON public.user_task_permissions;
CREATE POLICY "Users view own task permissions" ON public.user_task_permissions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'main_admin'));