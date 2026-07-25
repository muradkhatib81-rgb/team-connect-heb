-- Leave type on profile (manual leave) and on schedule cells (display: חופש רגיל / חופש מחלה).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS leave_type_code text
  CHECK (leave_type_code IS NULL OR leave_type_code IN ('regular', 'sick'));

COMMENT ON COLUMN public.profiles.leave_type_code IS
  'regular | sick — type of current profile leave (manual or from approved request).';

ALTER TABLE public.schedule_shifts
  ADD COLUMN IF NOT EXISTS leave_type_code text
  CHECK (leave_type_code IS NULL OR leave_type_code IN ('regular', 'sick'));

COMMENT ON COLUMN public.schedule_shifts.leave_type_code IS
  'When shift=off due to leave: regular → חופש רגיל, sick → חופש מחלה.';

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
     SET shift = 'off',
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

GRANT EXECUTE ON FUNCTION public.apply_leave_to_schedule_shifts(uuid, date, date, uuid, text)
  TO authenticated, service_role;

-- Keep 4-arg overload for older callers
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

GRANT EXECUTE ON FUNCTION public.apply_leave_to_schedule_shifts(uuid, date, date, uuid)
  TO authenticated, service_role;

-- Patch decide_leave_admin to set profile + schedule leave type from request type code
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

        UPDATE public.schedule_shifts
           SET leave_type_code = NULL
         WHERE employee_id = v_source.user_id
           AND branch_id = v_source.branch_id
           AND day_date >= v_source.start_date
           AND day_date <= v_source.end_date
           AND shift = 'off';
      END IF;
    END IF;

    PERFORM public.write_leave_audit('cancellation_approved', _id, r.user_id,
      jsonb_build_object('note', _note, 'cancels_request_id', r.cancels_request_id), r.branch_id);
  END IF;
END;
$$;

-- Admin cancel clears leave type
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
  r public.leave_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.has_leave_perm(v_actor, 'approve') THEN
    RAISE EXCEPTION 'אין הרשאה לביטול חופשה';
  END IF;

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
    UPDATE public.leave_requests SET status = 'cancelled', updated_at = now() WHERE id = r.id;
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
  END LOOP;

  PERFORM public.write_leave_audit(
    'manual_cancel', NULL, _user_id,
    jsonb_build_object('note', _note), v_branch
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
