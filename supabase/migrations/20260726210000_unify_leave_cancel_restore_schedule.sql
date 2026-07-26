-- Unify leave cancellation: clear profile + restore schedule cells that leave
-- overwrote, so dashboard חופש / סידור / employee file all drop together.
-- Also stash the pre-leave shift when applying leave (drafts without published snapshot).

ALTER TABLE public.schedule_shifts
  ADD COLUMN IF NOT EXISTS leave_replaced_shift text,
  ADD COLUMN IF NOT EXISTS leave_replaced_start_time time without time zone,
  ADD COLUMN IF NOT EXISTS leave_replaced_end_time time without time zone;

COMMENT ON COLUMN public.schedule_shifts.leave_replaced_shift IS
  'Shift value before leave forced off; restored when leave is cancelled.';

-- Apply leave: stash prior working shift once, then mark off + leave type.
CREATE OR REPLACE FUNCTION public.apply_leave_to_schedule_shifts(
  _user_id uuid,
  _start date,
  _end date,
  _branch_id uuid,
  _leave_type_code text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_code text := NULLIF(trim(_leave_type_code), '');
BEGIN
  IF v_code IS NOT NULL AND v_code NOT IN ('regular', 'sick') THEN
    RAISE EXCEPTION 'סוג חופשה לא תקין';
  END IF;

  UPDATE public.schedule_shifts
     SET leave_replaced_shift = CASE
           WHEN leave_type_code IS NULL
                AND shift IS NOT NULL
                AND shift IS DISTINCT FROM 'off'
             THEN shift
           ELSE leave_replaced_shift
         END,
         leave_replaced_start_time = CASE
           WHEN leave_type_code IS NULL
                AND shift IS NOT NULL
                AND shift IS DISTINCT FROM 'off'
             THEN start_time
           ELSE leave_replaced_start_time
         END,
         leave_replaced_end_time = CASE
           WHEN leave_type_code IS NULL
                AND shift IS NOT NULL
                AND shift IS DISTINCT FROM 'off'
             THEN end_time
           ELSE leave_replaced_end_time
         END,
         shift = 'off',
         start_time = NULL,
         end_time = NULL,
         leave_type_code = COALESCE(v_code, leave_type_code, 'regular')
   WHERE employee_id = _user_id
     AND branch_id = _branch_id
     AND day_date >= _start
     AND day_date <= _end;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 4-arg overload kept for older callers
CREATE OR REPLACE FUNCTION public.apply_leave_to_schedule_shifts(
  _user_id uuid,
  _start date,
  _end date,
  _branch_id uuid
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.apply_leave_to_schedule_shifts(_user_id, _start, _end, _branch_id, NULL::text);
$$;

-- Restore schedule cells marked by leave (single source of truth for all cancel paths).
CREATE OR REPLACE FUNCTION public.clear_leave_from_schedule_shifts(
  _user_id uuid,
  _start date,
  _end date,
  _branch_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF _start IS NULL OR _end IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.schedule_shifts ss
     SET shift = COALESCE(
           NULLIF(ss.leave_replaced_shift, ''),
           NULLIF(ss.published_shift, ''),
           NULLIF(ss.submitted_shift, ''),
           'off'
         ),
         start_time = CASE
           WHEN COALESCE(
                  NULLIF(ss.leave_replaced_shift, ''),
                  NULLIF(ss.published_shift, ''),
                  NULLIF(ss.submitted_shift, ''),
                  'off'
                ) = 'off'
             THEN NULL
           ELSE COALESCE(
             ss.leave_replaced_start_time,
             ss.published_start_time,
             ss.submitted_start_time
           )
         END,
         end_time = CASE
           WHEN COALESCE(
                  NULLIF(ss.leave_replaced_shift, ''),
                  NULLIF(ss.published_shift, ''),
                  NULLIF(ss.submitted_shift, ''),
                  'off'
                ) = 'off'
             THEN NULL
           ELSE COALESCE(
             ss.leave_replaced_end_time,
             ss.published_end_time,
             ss.submitted_end_time
           )
         END,
         leave_type_code = NULL,
         leave_replaced_shift = NULL,
         leave_replaced_start_time = NULL,
         leave_replaced_end_time = NULL
   WHERE ss.employee_id = _user_id
     AND ss.day_date >= _start
     AND ss.day_date <= _end
     AND (_branch_id IS NULL OR ss.branch_id IS NOT DISTINCT FROM _branch_id)
     AND ss.leave_type_code IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_leave_to_schedule_shifts(uuid, date, date, uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_leave_to_schedule_shifts(uuid, date, date, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_leave_from_schedule_shifts(uuid, date, date, uuid)
  TO authenticated, service_role;

-- Admin cancel from ניהול חופשות / employee clear paths
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

    PERFORM public.clear_leave_from_schedule_shifts(
      r.user_id, r.start_date, r.end_date, r.branch_id
    );

    IF v_start IS NULL OR r.start_date < v_start THEN
      v_start := r.start_date;
    END IF;
    IF v_end IS NULL OR r.end_date > v_end THEN
      v_end := r.end_date;
    END IF;
  END LOOP;

  -- Manual leave (no request) or any leftover leave-marked cells in profile window
  IF v_start IS NOT NULL AND v_end IS NOT NULL THEN
    PERFORM public.clear_leave_from_schedule_shifts(
      _user_id, v_start, v_end, v_branch
    );
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

-- Approved cancellation request: same schedule restore as admin cancel
CREATE OR REPLACE FUNCTION public.decide_leave_admin(
  _id uuid,
  _approve boolean,
  _note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.leave_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_source public.leave_requests%ROWTYPE;
  v_type_code text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO r FROM public.leave_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;
  IF r.status <> 'pending_admin' THEN RAISE EXCEPTION 'הבקשה אינה ממתינה לאישור הנהלה'; END IF;
  IF r.user_id = v_actor THEN RAISE EXCEPTION 'לא ניתן לאשר את הבקשה של עצמך'; END IF;

  IF _approve THEN
    IF NOT public.has_leave_perm(v_actor, 'approve') THEN
      RAISE EXCEPTION 'אין הרשאה לאשר חופשות';
    END IF;
  ELSE
    IF NOT public.has_leave_perm(v_actor, 'reject') THEN
      RAISE EXCEPTION 'אין הרשאה לדחות חופשות';
    END IF;
  END IF;

  SELECT code INTO v_type_code FROM public.leave_types WHERE id = r.leave_type_id;
  v_type_code := COALESCE(v_type_code, 'regular');

  IF NOT _approve THEN
    UPDATE public.leave_requests SET
      status = 'rejected',
      admin_decided_by = v_actor,
      admin_decided_at = now(),
      admin_note = NULLIF(trim(_note), ''),
      updated_at = now()
    WHERE id = _id;

    IF r.kind IN ('leave', 'extension') THEN
      UPDATE public.leave_balances
         SET reserved_days = GREATEST(0, reserved_days - r.days_count), updated_at = now()
       WHERE user_id = r.user_id AND leave_type_id = r.leave_type_id;
    END IF;

    PERFORM public.write_leave_audit('admin_rejected', _id, r.user_id,
      jsonb_build_object('note', _note, 'kind', r.kind::text), r.branch_id);
    RETURN;
  END IF;

  UPDATE public.leave_requests SET
    status = 'approved',
    admin_decided_by = v_actor,
    admin_decided_at = now(),
    admin_note = NULLIF(trim(_note), ''),
    updated_at = now()
  WHERE id = _id;

  IF r.kind = 'leave' THEN
    UPDATE public.leave_balances SET
      reserved_days = GREATEST(0, reserved_days - r.days_count),
      used_days = used_days + r.days_count,
      updated_at = now()
    WHERE user_id = r.user_id AND leave_type_id = r.leave_type_id;

    UPDATE public.profiles SET
      on_leave = true,
      leave_start_date = r.start_date,
      leave_end_date = r.end_date,
      leave_type_code = v_type_code
    WHERE id = r.user_id;

    PERFORM public.apply_leave_to_schedule_shifts(
      r.user_id, r.start_date, r.end_date, r.branch_id, v_type_code
    );

    PERFORM public.write_leave_audit('admin_approved', _id, r.user_id,
      jsonb_build_object('note', _note, 'applied_to_profile', true, 'leave_type_code', v_type_code), r.branch_id);

  ELSIF r.kind = 'extension' THEN
    UPDATE public.leave_balances SET
      reserved_days = GREATEST(0, reserved_days - r.days_count),
      used_days = used_days + r.days_count,
      updated_at = now()
    WHERE user_id = r.user_id AND leave_type_id = r.leave_type_id;

    IF r.extends_request_id IS NOT NULL THEN
      SELECT * INTO v_source FROM public.leave_requests WHERE id = r.extends_request_id FOR UPDATE;
      IF FOUND AND v_source.status = 'approved' THEN
        UPDATE public.leave_requests SET
          end_date = r.end_date,
          days_count = public.leave_count_days(v_source.start_date, r.end_date),
          updated_at = now()
        WHERE id = v_source.id;
      END IF;
    END IF;

    UPDATE public.profiles SET
      on_leave = true,
      leave_end_date = r.end_date,
      leave_type_code = v_type_code
    WHERE id = r.user_id;

    PERFORM public.apply_leave_to_schedule_shifts(
      r.user_id, r.start_date, r.end_date, r.branch_id, v_type_code
    );

    PERFORM public.write_leave_audit('extension_approved', _id, r.user_id,
      jsonb_build_object(
        'note', _note,
        'extends_request_id', r.extends_request_id,
        'leave_type_code', v_type_code,
        'new_end_date', r.end_date
      ), r.branch_id);

  ELSE
    -- cancellation approved
    IF r.cancels_request_id IS NOT NULL THEN
      SELECT * INTO v_source FROM public.leave_requests WHERE id = r.cancels_request_id;
      IF FOUND AND v_source.status = 'approved' THEN
        UPDATE public.leave_requests SET status = 'cancelled', updated_at = now()
         WHERE id = v_source.id;

        UPDATE public.leave_balances SET
          used_days = GREATEST(0, used_days - v_source.days_count),
          updated_at = now()
        WHERE user_id = v_source.user_id AND leave_type_id = v_source.leave_type_id;

        UPDATE public.profiles SET
          on_leave = false,
          leave_start_date = NULL,
          leave_end_date = NULL,
          leave_type_code = NULL
        WHERE id = v_source.user_id
          AND leave_start_date IS NOT DISTINCT FROM v_source.start_date
          AND leave_end_date IS NOT DISTINCT FROM v_source.end_date;

        PERFORM public.clear_leave_from_schedule_shifts(
          v_source.user_id, v_source.start_date, v_source.end_date, v_source.branch_id
        );
      END IF;
    END IF;

    PERFORM public.write_leave_audit('cancellation_approved', _id, r.user_id,
      jsonb_build_object('note', _note, 'cancels_request_id', r.cancels_request_id), r.branch_id);
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
