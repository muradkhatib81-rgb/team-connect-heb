-- Leave realtime + record who cancelled/rejected so employee cards update live.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'leave_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_requests;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'leave_balances'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_balances;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'leave_employee_accrual_rates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_employee_accrual_rates;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.notify_leave_employee(
  _user_id uuid,
  _branch_id uuid,
  _message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL OR NULLIF(btrim(_message), '') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
  VALUES (_user_id, NULL, btrim(_message), _branch_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_leave_employee(uuid, uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.leave_request_decision_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_actor_name text;
  v_note text;
  v_msg text;
  v_kind text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_actor := COALESCE(NEW.admin_decided_by, NEW.dept_decided_by);
  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'מנהל')
    INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor;
  IF v_actor_name IS NULL THEN
    v_actor_name := 'ההנהלה';
  END IF;

  v_note := COALESCE(NULLIF(btrim(NEW.admin_note), ''), NULLIF(btrim(NEW.dept_note), ''));
  v_kind := CASE NEW.kind::text
    WHEN 'cancellation' THEN 'בקשת הביטול'
    WHEN 'extension' THEN 'בקשת ההארכה'
    ELSE 'בקשת החופשה'
  END;

  IF NEW.status = 'rejected' THEN
    v_msg := format('%s שלך נדחתה על ידי %s', v_kind, v_actor_name);
    IF v_note IS NOT NULL THEN
      v_msg := v_msg || ' · ' || v_note;
    END IF;
  ELSIF NEW.status = 'cancelled' AND NEW.admin_decided_by IS NOT NULL THEN
    IF NEW.kind = 'leave' THEN
      v_msg := format('החופשה שלך בוטלה על ידי %s', v_actor_name);
    ELSIF NEW.kind = 'extension' THEN
      v_msg := format('הארכת החופשה שלך בוטלה על ידי %s', v_actor_name);
    ELSIF NEW.kind = 'cancellation' THEN
      v_msg := format('בקשת הביטול שלך בוטלה על ידי %s', v_actor_name);
    ELSE
      v_msg := format('%s שלך בוטלה על ידי %s', v_kind, v_actor_name);
    END IF;
    IF v_note IS NOT NULL THEN
      v_msg := v_msg || ' · ' || v_note;
    END IF;
  ELSIF NEW.status = 'approved' THEN
    v_msg := format('%s שלך אושרה על ידי %s', v_kind, v_actor_name);
  ELSIF NEW.status = 'pending_admin' AND OLD.status = 'pending_dept' THEN
    v_msg := format('%s שלך אושרה במחלקה וממתינה להנהלה', v_kind);
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.notify_leave_employee(NEW.user_id, NEW.branch_id, v_msg);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leave_request_decision_notify ON public.leave_requests;
CREATE TRIGGER trg_leave_request_decision_notify
  AFTER UPDATE OF status ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.leave_request_decision_notify();

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
        UPDATE public.leave_requests SET
          status = 'cancelled',
          admin_decided_by = v_actor,
          admin_decided_at = now(),
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
      jsonb_build_object('note', _note, 'cancels_request_id', r.cancels_request_id), r.branch_id);
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
