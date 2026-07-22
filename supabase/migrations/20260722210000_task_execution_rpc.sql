-- Trusted execution updates for assignees / department members.
-- Bypasses RLS while tasks_guard_assignee_update still validates auth.uid().

CREATE OR REPLACE FUNCTION public.assert_task_executor(_task_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t_department_id uuid;
  t_assignee_id uuid;
  has_named_assignees boolean;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;

  SELECT department_id, assignee_id
  INTO t_department_id, t_assignee_id
  FROM public.tasks
  WHERE id = _task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'משימה לא נמצאה';
  END IF;

  IF t_assignee_id = _user_id THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.task_assignees
    WHERE task_id = _task_id AND user_id = _user_id
  ) THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.task_assignees WHERE task_id = _task_id
  ) OR t_assignee_id IS NOT NULL
  INTO has_named_assignees;

  IF NOT has_named_assignees
     AND t_department_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.profiles
       WHERE id = _user_id AND department_id = t_department_id
     ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'אין הרשאה לעדכן משימה זו';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_task_executor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_task_executor(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.task_apply_execution(
  _task_id uuid,
  _status public.task_status,
  _employee_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_task_executor(_task_id, auth.uid());

  IF _status NOT IN ('in_progress', 'pending_approval') THEN
    RAISE EXCEPTION 'סטטוס לא נתמך לביצוע משימה';
  END IF;

  UPDATE public.tasks
  SET
    status = _status,
    employee_note = COALESCE(_employee_note, employee_note),
    updated_at = now()
  WHERE id = _task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.task_apply_execution(uuid, public.task_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_apply_execution(uuid, public.task_status, text) TO authenticated;
