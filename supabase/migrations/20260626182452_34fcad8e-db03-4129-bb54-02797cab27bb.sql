DROP POLICY "Task update" ON public.tasks;
CREATE POLICY "Task update" ON public.tasks FOR UPDATE
USING (
  has_task_edit_perm(auth.uid())
  OR has_task_approve_perm(auth.uid())
  OR has_task_close_perm(auth.uid())
  OR (department_id IN (SELECT id FROM departments WHERE manager_id = auth.uid()))
  OR (assignee_id = auth.uid())
  OR (created_by = auth.uid())
)
WITH CHECK (
  has_task_edit_perm(auth.uid())
  OR has_task_approve_perm(auth.uid())
  OR has_task_close_perm(auth.uid())
  OR (department_id IN (SELECT id FROM departments WHERE manager_id = auth.uid()))
  OR (assignee_id = auth.uid())
  OR (created_by = auth.uid())
);