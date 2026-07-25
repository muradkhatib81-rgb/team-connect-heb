-- If the employee's department has no assigned head (or the requester is the head),
-- skip pending_dept and send the leave request straight to management (pending_admin).

CREATE OR REPLACE FUNCTION public.submit_leave_request(
  _leave_type_id uuid,
  _start_date date,
  _end_date date,
  _note text DEFAULT NULL,
  _kind public.leave_request_kind DEFAULT 'leave',
  _cancels_request_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch uuid := public.current_active_branch();
  v_dept uuid;
  v_dept_manager uuid;
  v_days numeric;
  v_available numeric;
  v_warning boolean := false;
  v_status public.leave_request_status;
  v_id uuid;
  v_is_mgmt boolean;
  v_has_dept_approver boolean := false;
  v_type public.leave_types%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF v_branch IS NULL THEN
    SELECT branch_id INTO v_branch FROM public.profiles WHERE id = v_actor;
  END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'יש לבחור סניף פעיל'; END IF;

  PERFORM public.ensure_leave_types_for_branch(v_branch);

  SELECT * INTO v_type FROM public.leave_types WHERE id = _leave_type_id AND branch_id = v_branch AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'סוג חופשה לא תקין'; END IF;

  IF _end_date < _start_date THEN RAISE EXCEPTION 'תאריך סיום חייב להיות אחרי תאריך התחלה'; END IF;
  IF _start_date < CURRENT_DATE THEN RAISE EXCEPTION 'לא ניתן לבקש חופשה לתאריך שעבר'; END IF;
  IF _start_date > CURRENT_DATE + 30 THEN
    RAISE EXCEPTION 'ניתן לבקש חופשה עד 30 יום מהיום בלבד';
  END IF;

  SELECT department_id INTO v_dept FROM public.profiles WHERE id = v_actor;
  v_days := public.leave_count_days(_start_date, _end_date);

  IF _kind = 'leave' AND EXISTS (
    SELECT 1 FROM public.leave_requests r
    WHERE r.user_id = v_actor
      AND r.kind = 'leave'
      AND r.status IN ('pending_dept', 'pending_admin', 'approved')
      AND daterange(r.start_date, r.end_date, '[]') && daterange(_start_date, _end_date, '[]')
  ) THEN
    RAISE EXCEPTION 'קיימת בקשה או חופשה חופפת לתאריכים אלה';
  END IF;

  PERFORM public.ensure_leave_balance(v_actor, _leave_type_id, v_branch);
  v_available := COALESCE(public.leave_available_days(v_actor, _leave_type_id), 0);
  IF v_available < v_days THEN
    v_warning := true;
  END IF;

  v_is_mgmt := public.has_role(v_actor, 'branch_manager'::public.app_role)
            OR public.has_role(v_actor, 'assistant_manager'::public.app_role)
            OR public.has_role(v_actor, 'main_admin'::public.app_role)
            OR public.has_role(v_actor, 'system_admin'::public.app_role);

  -- Dept stage only when a different department head exists
  IF v_dept IS NOT NULL THEN
    SELECT d.manager_id INTO v_dept_manager
    FROM public.departments d
    WHERE d.id = v_dept;
    v_has_dept_approver := v_dept_manager IS NOT NULL AND v_dept_manager <> v_actor;
  END IF;

  IF v_is_mgmt OR NOT v_has_dept_approver THEN
    v_status := 'pending_admin';
  ELSE
    v_status := 'pending_dept';
  END IF;

  INSERT INTO public.leave_requests (
    user_id, branch_id, department_id, leave_type_id, kind, status,
    start_date, end_date, days_count, note, cancels_request_id, balance_warning
  ) VALUES (
    v_actor, v_branch, v_dept, _leave_type_id, _kind, v_status,
    _start_date, _end_date, v_days, NULLIF(trim(_note), ''), _cancels_request_id, v_warning
  ) RETURNING id INTO v_id;

  IF _kind = 'leave' THEN
    UPDATE public.leave_balances
       SET reserved_days = reserved_days + v_days, updated_at = now()
     WHERE user_id = v_actor AND leave_type_id = _leave_type_id;
  END IF;

  PERFORM public.write_leave_audit(
    'submitted', v_id, v_actor,
    jsonb_build_object(
      'kind', _kind::text,
      'start_date', _start_date,
      'end_date', _end_date,
      'days_count', v_days,
      'balance_warning', v_warning,
      'status', v_status::text,
      'skipped_dept', NOT v_has_dept_approver
    ),
    v_branch
  );

  RETURN v_id;
END;
$$;
