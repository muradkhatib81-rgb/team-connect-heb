-- Denormalize leave decision actor names so employees can see who decided
-- (profiles RLS blocks reading other users' names on the employee leave page).

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS admin_decider_name text,
  ADD COLUMN IF NOT EXISTS dept_decider_name text;

COMMENT ON COLUMN public.leave_requests.admin_decider_name IS
  'Display name of admin_decided_by at decision time (for employee-visible history).';
COMMENT ON COLUMN public.leave_requests.dept_decider_name IS
  'Display name of dept_decided_by at decision time (for employee-visible history).';

-- Backfill from profiles where readable in migration context
UPDATE public.leave_requests lr
SET admin_decider_name = COALESCE(
  NULLIF(btrim(p.full_name), ''),
  NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
  'מנהל'
)
FROM public.profiles p
WHERE lr.admin_decided_by = p.id
  AND lr.admin_decider_name IS NULL
  AND lr.admin_decided_by IS NOT NULL;

UPDATE public.leave_requests lr
SET dept_decider_name = COALESCE(
  NULLIF(btrim(p.full_name), ''),
  NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
  'מנהל'
)
FROM public.profiles p
WHERE lr.dept_decided_by = p.id
  AND lr.dept_decider_name IS NULL
  AND lr.dept_decided_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.leave_actor_display_name(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(btrim(full_name), ''),
    NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''),
    'מנהל'
  )
  FROM public.profiles
  WHERE id = _user_id;
$$;

GRANT EXECUTE ON FUNCTION public.leave_actor_display_name(uuid) TO authenticated, service_role;

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
  v_actor_name text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO r FROM public.leave_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;
  IF r.status <> 'pending_dept' THEN RAISE EXCEPTION 'הבקשה אינה ממתינה לאישור אחראי מחלקה'; END IF;
  IF r.user_id = v_actor THEN RAISE EXCEPTION 'לא ניתן לאשר את הבקשה של עצמך'; END IF;
  IF NOT public.is_dept_manager_of(v_actor, r.department_id) THEN
    RAISE EXCEPTION 'אין הרשאה לאשר בקשות במחלקה זו';
  END IF;

  v_actor_name := public.leave_actor_display_name(v_actor);

  IF _approve THEN
    UPDATE public.leave_requests SET
      status = 'pending_admin',
      dept_decided_by = v_actor,
      dept_decided_at = now(),
      dept_decider_name = v_actor_name,
      dept_note = NULLIF(trim(_note), ''),
      updated_at = now()
    WHERE id = _id;
    PERFORM public.write_leave_audit('dept_approved', _id, r.user_id,
      jsonb_build_object('note', _note, 'actor_name', v_actor_name), r.branch_id);
  ELSE
    UPDATE public.leave_requests SET
      status = 'rejected',
      dept_decided_by = v_actor,
      dept_decided_at = now(),
      dept_decider_name = v_actor_name,
      dept_note = NULLIF(trim(_note), ''),
      updated_at = now()
    WHERE id = _id;

    IF r.kind IN ('leave', 'extension') THEN
      UPDATE public.leave_balances
         SET reserved_days = GREATEST(0, reserved_days - r.days_count), updated_at = now()
       WHERE user_id = r.user_id AND leave_type_id = r.leave_type_id;
    END IF;

    PERFORM public.write_leave_audit('dept_rejected', _id, r.user_id,
      jsonb_build_object('note', _note, 'actor_name', v_actor_name), r.branch_id);
  END IF;
END;
$$;

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
  v_actor_name text;
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

  v_actor_name := public.leave_actor_display_name(v_actor);
  SELECT code INTO v_type_code FROM public.leave_types WHERE id = r.leave_type_id;
  v_type_code := COALESCE(v_type_code, 'regular');

  IF NOT _approve THEN
    UPDATE public.leave_requests SET
      status = 'rejected',
      admin_decided_by = v_actor,
      admin_decided_at = now(),
      admin_decider_name = v_actor_name,
      admin_note = NULLIF(trim(_note), ''),
      updated_at = now()
    WHERE id = _id;

    IF r.kind IN ('leave', 'extension') THEN
      UPDATE public.leave_balances
         SET reserved_days = GREATEST(0, reserved_days - r.days_count), updated_at = now()
       WHERE user_id = r.user_id AND leave_type_id = r.leave_type_id;
    END IF;

    PERFORM public.write_leave_audit('admin_rejected', _id, r.user_id,
      jsonb_build_object('note', _note, 'kind', r.kind::text, 'actor_name', v_actor_name), r.branch_id);
    RETURN;
  END IF;

  UPDATE public.leave_requests SET
    status = 'approved',
    admin_decided_by = v_actor,
    admin_decided_at = now(),
    admin_decider_name = v_actor_name,
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
      jsonb_build_object('note', _note, 'applied_to_profile', true, 'leave_type_code', v_type_code, 'actor_name', v_actor_name), r.branch_id);

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
        'new_end_date', r.end_date,
        'actor_name', v_actor_name
      ), r.branch_id);

  ELSE
    IF r.cancels_request_id IS NOT NULL THEN
      SELECT * INTO v_source FROM public.leave_requests WHERE id = r.cancels_request_id;
      IF FOUND AND v_source.status = 'approved' THEN
        UPDATE public.leave_requests SET
          status = 'cancelled',
          admin_decided_by = v_actor,
          admin_decided_at = now(),
          admin_decider_name = v_actor_name,
          admin_note = COALESCE(NULLIF(trim(_note), ''), admin_note),
          updated_at = now()
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
      jsonb_build_object('note', _note, 'cancels_request_id', r.cancels_request_id, 'actor_name', v_actor_name), r.branch_id);
  END IF;
END;
$$;

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

  v_actor_name := COALESCE(public.leave_actor_display_name(v_actor), 'מנהל');

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

  ALTER TABLE public.leave_requests DISABLE TRIGGER trg_leave_request_decision_notify;

  BEGIN
    FOR r IN
      SELECT * FROM public.leave_requests
      WHERE user_id = _user_id
        AND kind = 'leave'
        AND status = 'approved'
        AND end_date >= CURRENT_DATE
    LOOP
      UPDATE public.leave_requests
         SET status = 'cancelled',
             admin_decided_by = v_actor,
             admin_decided_at = now(),
             admin_decider_name = v_actor_name,
             admin_note = COALESCE(NULLIF(trim(_note), ''), admin_note),
             updated_at = now()
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

    UPDATE public.leave_requests
       SET status = 'cancelled',
           admin_decided_by = v_actor,
           admin_decided_at = now(),
           admin_decider_name = v_actor_name,
           admin_note = COALESCE(NULLIF(trim(_note), ''), admin_note),
           updated_at = now()
     WHERE user_id = _user_id
       AND status IN ('pending_dept', 'pending_admin')
       AND kind IN ('leave', 'extension', 'cancellation');
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.leave_requests ENABLE TRIGGER trg_leave_request_decision_notify;
    RAISE;
  END;

  ALTER TABLE public.leave_requests ENABLE TRIGGER trg_leave_request_decision_notify;

  IF v_start IS NOT NULL AND v_end IS NOT NULL THEN
    PERFORM public.clear_leave_from_schedule_shifts(
      _user_id, v_start, v_end, v_branch
    );
  END IF;

  v_when := to_char((now() AT TIME ZONE 'Asia/Jerusalem'), 'DD.MM.YYYY HH24:MI');

  PERFORM public.notify_leave_employee(
    _user_id,
    v_branch,
    format('החופשה שלך בוטלה על ידי %s · %s', v_actor_name, v_when)
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

-- Prefer denormalized name in realtime notifications too
CREATE OR REPLACE FUNCTION public.leave_request_decision_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
  v_note text;
  v_msg text;
  v_kind text;
  v_when text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_actor_name := COALESCE(
    NULLIF(btrim(NEW.admin_decider_name), ''),
    NULLIF(btrim(NEW.dept_decider_name), ''),
    public.leave_actor_display_name(COALESCE(NEW.admin_decided_by, NEW.dept_decided_by)),
    'ההנהלה'
  );

  v_note := COALESCE(NULLIF(btrim(NEW.admin_note), ''), NULLIF(btrim(NEW.dept_note), ''));
  v_when := to_char(
    (COALESCE(NEW.admin_decided_at, NEW.dept_decided_at, now()) AT TIME ZONE 'Asia/Jerusalem'),
    'DD.MM.YYYY HH24:MI'
  );
  v_kind := CASE NEW.kind::text
    WHEN 'cancellation' THEN 'בקשת הביטול'
    WHEN 'extension' THEN 'בקשת ההארכה'
    ELSE 'בקשת החופשה'
  END;

  IF NEW.status = 'rejected' THEN
    v_msg := format('%s שלך נדחתה על ידי %s · %s', v_kind, v_actor_name, v_when);
    IF v_note IS NOT NULL THEN
      v_msg := v_msg || ' · ' || v_note;
    END IF;
  ELSIF NEW.status = 'cancelled' AND NEW.admin_decided_by IS NOT NULL THEN
    IF NEW.kind = 'leave' THEN
      v_msg := format('החופשה שלך בוטלה על ידי %s · %s', v_actor_name, v_when);
    ELSIF NEW.kind = 'extension' THEN
      v_msg := format('הארכת החופשה שלך בוטלה על ידי %s · %s', v_actor_name, v_when);
    ELSIF NEW.kind = 'cancellation' THEN
      v_msg := format('בקשת הביטול שלך בוטלה על ידי %s · %s', v_actor_name, v_when);
    ELSE
      v_msg := format('%s שלך בוטלה על ידי %s · %s', v_kind, v_actor_name, v_when);
    END IF;
    IF v_note IS NOT NULL THEN
      v_msg := v_msg || ' · ' || v_note;
    END IF;
  ELSIF NEW.status = 'approved' THEN
    v_msg := format('%s שלך אושרה על ידי %s · %s', v_kind, v_actor_name, v_when);
  ELSIF NEW.status = 'pending_admin' AND OLD.status = 'pending_dept' THEN
    v_msg := format('%s שלך אושרה במחלקה על ידי %s וממתינה להנהלה · %s', v_kind, v_actor_name, v_when);
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.notify_leave_employee(NEW.user_id, NEW.branch_id, v_msg);
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
