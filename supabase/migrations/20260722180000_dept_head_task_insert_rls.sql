-- Allow department heads to INSERT tasks for their department.
-- Server logic (canCreateForDept) already permits:
--   - departments.manager_id = user
--   - department_manager role + profile.department_id match
-- RLS "Task insert" only checked manager_id; align policies.

CREATE OR REPLACE FUNCTION public.can_dept_head_create_task(_user_id uuid, _dept_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _dept_id IS NOT NULL AND (
    _dept_id IN (SELECT d.id FROM public.departments d WHERE d.manager_id = _user_id)
    OR (
      public.has_role(_user_id, 'department_manager')
      AND _dept_id = (SELECT p.department_id FROM public.profiles p WHERE p.id = _user_id)
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_dept_head_create_task(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_dept_head_create_task(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Task insert" ON public.tasks;
CREATE POLICY "Task insert" ON public.tasks
  FOR INSERT TO authenticated WITH CHECK (
    public.has_task_create_perm(auth.uid())
    OR public.can_dept_head_create_task(auth.uid(), department_id)
  );
