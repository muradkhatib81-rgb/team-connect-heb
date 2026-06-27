
CREATE OR REPLACE FUNCTION public.can_view_task(_task_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = _task_id
      AND (
        public.has_task_edit_perm(_user_id)
        OR public.is_admin(_user_id)
        OR t.created_by = _user_id
        OR t.assignee_id = _user_id
        OR t.target_scope = 'all_departments'::task_target_scope
        OR EXISTS (SELECT 1 FROM public.task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = _user_id)
        OR t.department_id IN (SELECT d.id FROM public.departments d WHERE d.manager_id = _user_id)
        OR t.department_id = (SELECT p.department_id FROM public.profiles p WHERE p.id = _user_id)
        OR EXISTS (
          SELECT 1 FROM public.task_departments td
          JOIN public.profiles p ON p.id = _user_id
          WHERE td.task_id = t.id AND td.department_id = p.department_id
        )
        OR EXISTS (
          SELECT 1 FROM public.task_departments td
          JOIN public.departments d ON d.id = td.department_id
          WHERE td.task_id = t.id AND d.manager_id = _user_id
        )
      )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.can_view_task(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_view_task(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS task_activity_select ON public.task_activity_log;
CREATE POLICY task_activity_select ON public.task_activity_log FOR SELECT
USING (public.can_view_task(task_id, auth.uid()));

DROP POLICY IF EXISTS task_comments_select ON public.task_comments;
CREATE POLICY task_comments_select ON public.task_comments FOR SELECT
USING (public.can_view_task(task_id, auth.uid()));
