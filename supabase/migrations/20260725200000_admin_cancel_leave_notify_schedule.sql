-- Admin cancel leave: clear schedule leave marking, notify employee dashboard,
-- include canceller name + Jerusalem date/time. Dept managers cannot call this
-- (has_leave_perm approve excludes department_manager).

CREATE OR REPLACE FUNCTION public.admin_cancel_active_leave(
  _user_id uuid,
  _note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch uuid := public.current_active_branch();
  v_start date;
  v_end date;
  v_type text;
  v_actor_name text;
  v_when text;
  r public.leave_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.has_leave_perm(v_actor, 'approve') THEN
    RAISE EXCEPTION 'אין הרשאה לביטול חופשה';
  END IF;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'מנהל')
    INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor;

  IF v_actor_name IS NULL THEN
    v_actor_name := 'מנהל';
  END IF;

  SELECT leave_start_date, leave_end_date, leave_type_code
    INTO v_start, v_end, v_type
  FROM public.profiles
  WHERE id = _user_id;

  UPDATE public.profiles SET
    on_leave = false,
    leave_start_date = NULL,
    leave_end_date = NULL,
    leave_type_code = NULL
  WHERE id = _user_id;

  FOR r IN
    SELECT * FROM public.leave_requests
    WHERE user_id = _user_id
      AND kind = 'leave'
      AND status = 'approved'
      AND end_date >= CURRENT_DATE
  LOOP
    UPDATE public.leave_requests
       SET status = 'cancelled', updated_at = now()
     WHERE id = r.id;

    UPDATE public.leave_balances SET
      used_days = GREATEST(0, used_days - r.days_count),
      updated_at = now()
    WHERE user_id = r.user_id AND leave_type_id = r.leave_type_id;

    UPDATE public.schedule_shifts
       SET leave_type_code = NULL
     WHERE employee_id = r.user_id
       AND branch_id = r.branch_id
       AND day_date >= r.start_date
       AND day_date <= r.end_date
       AND shift = 'off';

    IF v_start IS NULL OR r.start_date < v_start THEN
      v_start := r.start_date;
    END IF;
    IF v_end IS NULL OR r.end_date > v_end THEN
      v_end := r.end_date;
    END IF;
  END LOOP;

  -- Manual leave (no request) or leftover cells: clear leave type on off days
  IF v_start IS NOT NULL AND v_end IS NOT NULL THEN
    UPDATE public.schedule_shifts
       SET leave_type_code = NULL
     WHERE employee_id = _user_id
       AND (v_branch IS NULL OR branch_id IS NOT DISTINCT FROM v_branch)
       AND day_date >= v_start
       AND day_date <= v_end
       AND shift = 'off';
  END IF;

  v_when := to_char((now() AT TIME ZONE 'Asia/Jerusalem'), 'DD.MM.YYYY HH24:MI');

  INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
  VALUES (
    _user_id,
    NULL,
    format('החופשה שלך בוטלה על ידי %s · %s', v_actor_name, v_when),
    v_branch
  );

  PERFORM public.write_leave_audit(
    'manual_cancel', NULL, _user_id,
    jsonb_build_object(
      'note', _note,
      'actor_name', v_actor_name,
      'cancelled_at_local', v_when,
      'leave_start_date', v_start,
      'leave_end_date', v_end,
      'leave_type_code', v_type
    ),
    v_branch
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
