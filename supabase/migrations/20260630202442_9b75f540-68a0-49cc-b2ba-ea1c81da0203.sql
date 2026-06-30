
-- Replace blocker checker with a richer breakdown
CREATE OR REPLACE FUNCTION public.get_branch_delete_blockers(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_emp int := 0;
  v_dept int := 0;
  v_sched int := 0;
  v_tasks int := 0;
  v_msgs int := 0;
  v_notifs int := 0;
  v_reports int := 0;
  v_operational int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_system_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*) INTO v_emp    FROM public.profiles      WHERE branch_id = _branch_id;
  SELECT COUNT(*) INTO v_dept   FROM public.departments   WHERE branch_id = _branch_id;
  SELECT COUNT(*) INTO v_sched  FROM public.schedules     WHERE branch_id = _branch_id;
  SELECT COUNT(*) INTO v_tasks  FROM public.tasks         WHERE branch_id = _branch_id;
  SELECT
    (SELECT COUNT(*) FROM public.messages       WHERE branch_id = _branch_id)
  + (SELECT COUNT(*) FROM public.announcements  WHERE branch_id = _branch_id)
    INTO v_msgs;
  SELECT
    (SELECT COUNT(*) FROM public.schedule_notifications WHERE branch_id = _branch_id)
  + (SELECT COUNT(*) FROM public.break_requests         WHERE branch_id = _branch_id)
    INTO v_notifs;
  SELECT
    (SELECT COUNT(*) FROM public.schedule_audit_log       WHERE branch_id = _branch_id)
  + (SELECT COUNT(*) FROM public.communications_audit_log WHERE branch_id = _branch_id)
  + (SELECT COUNT(*) FROM public.task_activity_log        WHERE branch_id = _branch_id)
  + (SELECT COUNT(*) FROM public.profile_status_log       WHERE branch_id = _branch_id)
  + (SELECT COUNT(*) FROM public.employee_archive         WHERE branch_id = _branch_id)
  + (SELECT COUNT(*) FROM public.employee_of_month        WHERE branch_id = _branch_id)
  + (SELECT COUNT(*) FROM public.task_recurrences         WHERE branch_id = _branch_id)
    INTO v_reports;

  v_operational := v_emp + v_sched + v_tasks + v_msgs + v_notifs + v_reports;

  RETURN jsonb_build_object(
    'canDelete', v_operational = 0,
    'onlyDepartments', (v_operational = 0 AND v_dept > 0),
    'isEmpty', (v_operational = 0 AND v_dept = 0),
    'employees', v_emp,
    'departments', v_dept,
    'schedules', v_sched,
    'tasks', v_tasks,
    'messages', v_msgs,
    'notifications', v_notifs,
    'reports', v_reports
  );
END;
$function$;

-- Cascade-delete a branch together with its departments and branch-scoped configuration.
-- Refuses if any operational data remains, so no orphan records can be created.
CREATE OR REPLACE FUNCTION public.delete_branch_cascade(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  v_dept_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_system_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v := public.get_branch_delete_blockers(_branch_id);
  IF NOT (v->>'canDelete')::boolean THEN
    RETURN jsonb_build_object('deleted', false, 'blockers', v);
  END IF;

  v_dept_count := (v->>'departments')::int;

  -- Branch-scoped configuration that is safe to remove with the branch.
  DELETE FROM public.user_task_permissions WHERE branch_id = _branch_id;
  DELETE FROM public.break_settings        WHERE branch_id = _branch_id;
  DELETE FROM public.company_settings      WHERE branch_id = _branch_id;
  DELETE FROM public.shift_definitions     WHERE branch_id = _branch_id;
  DELETE FROM public.job_titles            WHERE branch_id = _branch_id;
  DELETE FROM public.departments           WHERE branch_id = _branch_id;
  DELETE FROM public.branches              WHERE id        = _branch_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'departments_deleted', v_dept_count,
    'blockers', v
  );
END;
$function$;
