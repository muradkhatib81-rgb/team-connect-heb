-- Leave extensions: during an approved leave, request extra days with choosable type
-- (regular / sick), same dept→admin approval chain.

ALTER TYPE public.leave_request_kind ADD VALUE IF NOT EXISTS 'extension';

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS extends_request_id uuid REFERENCES public.leave_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leave_requests_extends
  ON public.leave_requests(extends_request_id)
  WHERE extends_request_id IS NOT NULL;

-- Full submit with leave / cancellation / extension + skip dept without manager
CREATE OR REPLACE FUNCTION public.submit_leave_request(
  _leave_type_id uuid,
  _start_date date,
  _end_date date,
  _note text DEFAULT NULL,
  _kind public.leave_request_kind DEFAULT 'leave',
  _cancels_request_id uuid DEFAULT NULL,
  _extends_request_id uuid DEFAULT NULL
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
  v_source public.leave_requests%ROWTYPE;
  v_ext_start date;
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

  SELECT department_id INTO v_dept FROM public.profiles WHERE id = v_actor;

  -- ---------- Extension: during an active approved leave ----------
  IF _kind = 'extension' THEN
    IF _extends_request_id IS NULL THEN
      RAISE EXCEPTION 'חסר מזהה חופשה להארכה';
    END IF;

    SELECT * INTO v_source FROM public.leave_requests WHERE id = _extends_request_id FOR SHARE;
    IF NOT FOUND OR v_source.user_id <> v_actor THEN
      RAISE EXCEPTION 'חופשה להארכה לא נמצאה';
    END IF;
    IF v_source.kind <> 'leave' OR v_source.status <> 'approved' THEN
      RAISE EXCEPTION 'ניתן להאריך רק חופשה מאושרת פעילה';
    END IF;
    IF CURRENT_DATE < v_source.start_date OR CURRENT_DATE > v_source.end_date THEN
      RAISE EXCEPTION 'ניתן לבקש הארכה רק במהלך תקופת החופשה';
    END IF;

    v_ext_start := v_source.end_date + 1;
    IF _start_date IS DISTINCT FROM v_ext_start THEN
      -- Force extension period to start the day after current leave ends
      _start_date := v_ext_start;
    END IF;
    IF _end_date < _start_date THEN
      RAISE EXCEPTION 'תאריך סיום ההארכה חייב להיות אחרי סיום החופשה הנוכחית';
    END IF;
    IF _end_date > CURRENT_DATE + 30 THEN
      RAISE EXCEPTION 'ניתן להאריך חופשה עד 30 יום מהיום בלבד';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.leave_requests r
      WHERE r.user_id = v_actor
        AND r.kind = 'extension'
        AND r.extends_request_id = _extends_request_id
        AND r.status IN ('pending_dept', 'pending_admin')
    ) THEN
      RAISE EXCEPTION 'כבר קיימת בקשת הארכה ממתינה לחופשה זו';
    END IF;

  ELSIF _kind = 'cancellation' THEN
    IF _cancels_request_id IS NULL THEN
      RAISE EXCEPTION 'חסר מזהה חופשה לביטול';
    END IF;
    IF _start_date < CURRENT_DATE THEN
      RAISE EXCEPTION 'לא ניתן לבקש ביטול לתאריך שעבר';
    END IF;

  ELSE
    -- Regular leave
    IF _start_date < CURRENT_DATE THEN RAISE EXCEPTION 'לא ניתן לבקש חופשה לתאריך שעבר'; END IF;
    IF _start_date > CURRENT_DATE + 30 THEN
      RAISE EXCEPTION 'ניתן לבקש חופשה עד 30 יום מהיום בלבד';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.leave_requests r
      WHERE r.user_id = v_actor
        AND r.kind = 'leave'
        AND r.status IN ('pending_dept', 'pending_admin', 'approved')
        AND daterange(r.start_date, r.end_date, '[]') && daterange(_start_date, _end_date, '[]')
    ) THEN
      RAISE EXCEPTION 'קיימת בקשה או חופשה חופפת לתאריכים אלה';
    END IF;
  END IF;

  v_days := public.leave_count_days(_start_date, _end_date);

  PERFORM public.ensure_leave_balance(v_actor, _leave_type_id, v_branch);
  v_available := COALESCE(public.leave_available_days(v_actor, _leave_type_id), 0);
  IF (_kind = 'leave' OR _kind = 'extension') AND v_available < v_days THEN
    v_warning := true;
  END IF;

  v_is_mgmt := public.has_role(v_actor, 'branch_manager'::public.app_role)
            OR public.has_role(v_actor, 'assistant_manager'::public.app_role)
            OR public.has_role(v_actor, 'main_admin'::public.app_role)
            OR public.has_role(v_actor, 'system_admin'::public.app_role);

  IF v_dept IS NOT NULL THEN
    SELECT d.manager_id INTO v_dept_manager FROM public.departments d WHERE d.id = v_dept;
    v_has_dept_approver := v_dept_manager IS NOT NULL AND v_dept_manager <> v_actor;
  END IF;

  IF v_is_mgmt OR NOT v_has_dept_approver THEN
    v_status := 'pending_admin';
  ELSE
    v_status := 'pending_dept';
  END IF;

  INSERT INTO public.leave_requests (
    user_id, branch_id, department_id, leave_type_id, kind, status,
    start_date, end_date, days_count, note, cancels_request_id, extends_request_id, balance_warning
  ) VALUES (
    v_actor, v_branch, v_dept, _leave_type_id, _kind, v_status,
    _start_date, _end_date, v_days, NULLIF(trim(_note), ''),
    _cancels_request_id, _extends_request_id, v_warning
  ) RETURNING id INTO v_id;

  IF _kind IN ('leave', 'extension') THEN
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
      'leave_type_id', _leave_type_id,
      'extends_request_id', _extends_request_id,
      'skipped_dept', NOT v_has_dept_approver
    ),
    v_branch
  );

  RETURN v_id;
END;
$$;

-- Reject at dept: release reserved for leave + extension
CREATE OR REPLACE FUNCTION public.decide_leave_dept(
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
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO r FROM public.leave_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;
  IF r.status <> 'pending_dept' THEN RAISE EXCEPTION 'הבקשה אינה ממתינה לאישור אחראי מחלקה'; END IF;
  IF r.user_id = v_actor THEN RAISE EXCEPTION 'לא ניתן לאשר את הבקשה של עצמך'; END IF;
  IF NOT public.is_dept_manager_of(v_actor, r.department_id) THEN
    RAISE EXCEPTION 'אין הרשאה לאשר בקשות במחלקה זו';
  END IF;

  IF _approve THEN
    UPDATE public.leave_requests SET
      status = 'pending_admin',
      dept_decided_by = v_actor,
      dept_decided_at = now(),
      dept_note = NULLIF(trim(_note), ''),
      updated_at = now()
    WHERE id = _id;
    PERFORM public.write_leave_audit('dept_approved', _id, r.user_id,
      jsonb_build_object('note', _note), r.branch_id);
  ELSE
    UPDATE public.leave_requests SET
      status = 'rejected',
      dept_decided_by = v_actor,
      dept_decided_at = now(),
      dept_note = NULLIF(trim(_note), ''),
      updated_at = now()
    WHERE id = _id;

    IF r.kind IN ('leave', 'extension') THEN
      UPDATE public.leave_balances
         SET reserved_days = GREATEST(0, reserved_days - r.days_count), updated_at = now()
       WHERE user_id = r.user_id AND leave_type_id = r.leave_type_id;
    END IF;

    PERFORM public.write_leave_audit('dept_rejected', _id, r.user_id,
      jsonb_build_object('note', _note), r.branch_id);
  END IF;
END;
$$;

-- Admin decide: handle leave, extension, cancellation
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
      leave_end_date = r.end_date
    WHERE id = r.user_id;

    PERFORM public.apply_leave_to_schedule_shifts(
      r.user_id, r.start_date, r.end_date, r.branch_id
    );

    PERFORM public.write_leave_audit('admin_approved', _id, r.user_id,
      jsonb_build_object('note', _note, 'applied_to_profile', true), r.branch_id);

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
      leave_end_date = r.end_date
    WHERE id = r.user_id;

    PERFORM public.apply_leave_to_schedule_shifts(
      r.user_id, r.start_date, r.end_date, r.branch_id
    );

    PERFORM public.write_leave_audit('extension_approved', _id, r.user_id,
      jsonb_build_object(
        'note', _note,
        'extends_request_id', r.extends_request_id,
        'leave_type_id', r.leave_type_id,
        'new_end_date', r.end_date
      ), r.branch_id);

  ELSE
    -- Cancellation
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
          leave_end_date = NULL
        WHERE id = v_source.user_id
          AND leave_start_date IS NOT DISTINCT FROM v_source.start_date
          AND leave_end_date IS NOT DISTINCT FROM v_source.end_date;
      END IF;
    END IF;

    PERFORM public.write_leave_audit('cancellation_approved', _id, r.user_id,
      jsonb_build_object('note', _note, 'cancels_request_id', r.cancels_request_id), r.branch_id);
  END IF;
END;
$$;

-- Drop old 6-arg overload if present, keep new 7-arg signature
DO $$
BEGIN
  -- Recreate grants for new signature
  NULL;
END $$;

REVOKE ALL ON FUNCTION public.submit_leave_request(uuid, date, date, text, public.leave_request_kind, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_leave_request(uuid, date, date, text, public.leave_request_kind, uuid, uuid) TO authenticated, service_role;

-- Also grant the 6-arg wrapper for backwards compatibility via DEFAULT on last param
CREATE OR REPLACE FUNCTION public.submit_leave_request(
  _leave_type_id uuid,
  _start_date date,
  _end_date date,
  _note text DEFAULT NULL,
  _kind public.leave_request_kind DEFAULT 'leave',
  _cancels_request_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.submit_leave_request(
    _leave_type_id, _start_date, _end_date, _note, _kind, _cancels_request_id, NULL::uuid
  );
$$;

GRANT EXECUTE ON FUNCTION public.submit_leave_request(uuid, date, date, text, public.leave_request_kind, uuid) TO authenticated, service_role;
