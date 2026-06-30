
CREATE OR REPLACE FUNCTION public.get_branch_delete_blockers(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp int := 0;
  v_dept int := 0;
  v_sched int := 0;
  v_tasks int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_system_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*) INTO v_emp   FROM public.profiles    WHERE branch_id = _branch_id;
  SELECT COUNT(*) INTO v_dept  FROM public.departments WHERE branch_id = _branch_id;
  SELECT COUNT(*) INTO v_sched FROM public.schedules   WHERE branch_id = _branch_id;
  SELECT COUNT(*) INTO v_tasks FROM public.tasks       WHERE branch_id = _branch_id;

  RETURN jsonb_build_object(
    'canDelete', (v_emp + v_dept + v_sched + v_tasks) = 0,
    'employees', v_emp,
    'departments', v_dept,
    'schedules', v_sched,
    'tasks', v_tasks
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_branch_delete_blockers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_branch_delete_blockers(uuid) TO authenticated;
