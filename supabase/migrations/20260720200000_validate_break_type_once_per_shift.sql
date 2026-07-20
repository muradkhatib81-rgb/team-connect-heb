-- Enforce at most one break request per (employee, shift window, break_setting_id).
-- Does not change permissions, status workflow, or activation logic.

CREATE OR REPLACE FUNCTION public.break_consumed_statuses()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'scheduled', 'pending_approval', 'approved', 'waiting_for_start', 'active',
    'completed', 'ended_by_manager'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION public.validate_break_type_once_per_shift(
  _user_id uuid,
  _break_setting_id uuid,
  _planned_start timestamptz,
  _exclude_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift record;
  v_type_name text;
  v_day date := (_planned_start AT TIME ZONE 'Asia/Jerusalem')::date;
  v_window_start timestamptz;
  v_window_end timestamptz;
BEGIN
  IF _break_setting_id IS NULL THEN
    RAISE EXCEPTION 'יש לבחור סוג הפסקה';
  END IF;

  IF _planned_start IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_shift
  FROM public.get_employee_shift_bounds(_user_id, _planned_start)
  LIMIT 1;

  IF FOUND AND v_shift.shift_start IS NOT NULL THEN
    v_window_start := v_shift.shift_start;
    v_window_end := v_shift.shift_end;
  ELSE
    -- Fallback when no published shift: Jerusalem calendar day.
    v_window_start := (v_day + time '00:00') AT TIME ZONE 'Asia/Jerusalem';
    v_window_end := v_window_start + interval '1 day';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.break_requests br
    WHERE br.user_id = _user_id
      AND br.break_setting_id = _break_setting_id
      AND (_exclude_id IS NULL OR br.id <> _exclude_id)
      AND br.status::text = ANY(public.break_consumed_statuses())
      AND COALESCE(br.planned_start, br.requested_at) >= v_window_start
      AND COALESCE(br.planned_start, br.requested_at) < v_window_end
  ) THEN
    SELECT COALESCE(bs.name, 'הפסקה') INTO v_type_name
    FROM public.break_settings bs
    WHERE bs.id = _break_setting_id;

    RAISE EXCEPTION 'כבר נוצלה הפסקת "%" במשמרת זו — לא ניתן לבקש אותה שוב', v_type_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.break_requests_apply_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.break_policy;
  v_branch uuid;
BEGIN
  NEW.planned_start := COALESCE(NEW.planned_start, NEW.requested_at);
  NEW.planned_duration := COALESCE(NEW.planned_duration, NEW.duration_minutes);
  NEW.duration_minutes := COALESCE(NEW.duration_minutes, NEW.planned_duration);
  NEW.requested_at := NEW.planned_start;

  SELECT COALESCE(pr.branch_id, d.branch_id)
    INTO v_branch
    FROM public.profiles pr
    LEFT JOIN public.departments d ON d.id = COALESCE(NEW.department_id, pr.department_id)
   WHERE pr.id = NEW.user_id;

  NEW.branch_id := v_branch;

  PERFORM public.validate_break_request_times(NEW.user_id, NEW.planned_start, NEW.planned_duration, NULL);
  PERFORM public.validate_break_type_once_per_shift(
    NEW.user_id, NEW.break_setting_id, NEW.planned_start, NULL
  );

  NEW.started_at := NULL;
  NEW.ends_at := NULL;
  NEW.completed_at := NULL;
  NEW.end_verified_by := NULL;
  NEW.ending_verified_at := NULL;
  NEW.last_modified_at := now();
  NEW.actual_start := NULL;
  NEW.actual_end := NULL;
  NEW.actual_duration := NULL;
  NEW.overtime_minutes := NULL;
  NEW.ended_by := NULL;
  NEW.ended_by_manager_id := NULL;
  NEW.ended_by_manager_name := NULL;

  p := public.get_break_policy();

  IF p.requires_approval = false THEN
    NEW.status := 'scheduled'::public.break_request_status;
    NEW.approved_at_time := COALESCE(NEW.approved_at_time, NEW.planned_start);
    NEW.approved_by := COALESCE(NEW.approved_by, NEW.user_id);
    NEW.approval_decided_at := COALESCE(NEW.approval_decided_at, now());
  ELSE
    NEW.status := 'pending_approval'::public.break_request_status;
    NEW.approved_at_time := NULL;
    NEW.approved_by := NULL;
    NEW.approval_decided_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_break_request(
  _id uuid,
  _approved_at_time timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_time timestamptz;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.can_approve_break_by_policy(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לאשר הפסקות';
  END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;
  IF r.status <> 'pending_approval'::public.break_request_status THEN
    RAISE EXCEPTION 'ניתן לאשר רק בקשות הממתינות לאישור';
  END IF;

  v_time := COALESCE(_approved_at_time, r.planned_start, r.requested_at);
  PERFORM public.validate_break_request_times(r.user_id, v_time, COALESCE(r.planned_duration, r.duration_minutes), _id);
  PERFORM public.validate_break_type_once_per_shift(r.user_id, r.break_setting_id, v_time, _id);

  UPDATE public.break_requests
     SET status = 'approved'::public.break_request_status,
         approved_at_time = v_time,
         planned_start = v_time,
         requested_at = v_time,
         approved_by = v_actor,
         approval_decided_at = now(),
         last_modified_at = now()
   WHERE id = _id;

  PERFORM public.write_break_audit(_id, v_actor, r.user_id, 'approve',
    jsonb_build_object('approved_at_time', v_time), r.branch_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_break_request(
  _id uuid,
  _new_start timestamptz,
  _new_duration integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_dur integer;
  v_is_manager boolean;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;

  v_is_manager := public.can_approve_break_by_policy(v_actor);

  IF NOT v_is_manager AND r.user_id <> v_actor THEN
    RAISE EXCEPTION 'אין הרשאה';
  END IF;

  IF NOT v_is_manager AND r.status NOT IN (
    'pending_approval'::public.break_request_status,
    'scheduled'::public.break_request_status,
    'waiting_for_start'::public.break_request_status,
    'approved'::public.break_request_status
  ) THEN
    RAISE EXCEPTION 'לא ניתן לערוך הפסקה במצב זה';
  END IF;

  IF v_is_manager AND r.status = 'active'::public.break_request_status THEN
    RAISE EXCEPTION 'לא ניתן לשנות מועד להפסקה פעילה';
  END IF;

  v_dur := COALESCE(_new_duration, r.planned_duration, r.duration_minutes);
  PERFORM public.validate_break_request_times(r.user_id, _new_start, v_dur, _id);
  PERFORM public.validate_break_type_once_per_shift(r.user_id, r.break_setting_id, _new_start, _id);

  UPDATE public.break_requests
     SET planned_start = _new_start,
         requested_at = _new_start,
         approved_at_time = CASE
           WHEN status IN ('approved'::public.break_request_status, 'waiting_for_start'::public.break_request_status)
           THEN _new_start ELSE approved_at_time END,
         planned_duration = v_dur,
         duration_minutes = v_dur,
         last_modified_at = now()
   WHERE id = _id;

  PERFORM public.write_break_audit(_id, v_actor, r.user_id, 'reschedule',
    jsonb_build_object('new_start', _new_start, 'new_duration', v_dur), r.branch_id);

  IF v_is_manager AND r.status = 'pending_approval'::public.break_request_status THEN
    PERFORM public.approve_break_request(_id, _new_start);
  END IF;
END;
$$;
