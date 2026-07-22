-- Allow department members and multi-assignees to UPDATE tasks they execute.
-- Aligns RLS with tasks_guard_assignee_update() (in_dept / is_assignee).

DROP POLICY IF EXISTS "Task update" ON public.tasks;
CREATE POLICY "Task update" ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    public.has_task_edit_perm(auth.uid())
    OR public.has_task_approve_perm(auth.uid())
    OR public.has_task_close_perm(auth.uid())
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
    OR department_id = (SELECT p.department_id FROM public.profiles p WHERE p.id = auth.uid())
    OR assignee_id = auth.uid()
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.task_assignees ta
      WHERE ta.task_id = tasks.id AND ta.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_task_edit_perm(auth.uid())
    OR public.has_task_approve_perm(auth.uid())
    OR public.has_task_close_perm(auth.uid())
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
    OR department_id = (SELECT p.department_id FROM public.profiles p WHERE p.id = auth.uid())
    OR assignee_id = auth.uid()
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.task_assignees ta
      WHERE ta.task_id = tasks.id AND ta.user_id = auth.uid()
    )
  );
