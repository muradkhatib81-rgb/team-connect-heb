-- Break cancel / manager-end notifications: include actor name + local date/time.
-- No permission / RLS changes.

ALTER TABLE public.break_requests
  ADD COLUMN IF NOT EXISTS cancelled_by_name text;

COMMENT ON COLUMN public.break_requests.cancelled_by_name IS
  'Display name of cancelled_by at cancel time (for employee-visible history).';

CREATE OR REPLACE FUNCTION public.break_actor_display_name(_user_id uuid)
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

GRANT EXECUTE ON FUNCTION public.break_actor_display_name(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_break_request(_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_is_manager boolean;
  v_new_status public.break_request_status;
  v_action text;
  v_actor_name text;
  v_when text;
  v_msg text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;

  v_is_manager := public.can_manually_end_break(v_actor) OR public.can_approve_break_by_policy(v_actor);
  v_actor_name := COALESCE(public.break_actor_display_name(v_actor), 'מנהל');
  v_when := to_char((now() AT TIME ZONE 'Asia/Jerusalem'), 'DD.MM.YYYY HH24:MI');

  IF v_is_manager THEN
    IF r.status = 'active'::public.break_request_status THEN
      RAISE EXCEPTION 'לא ניתן לבטל הפסקה פעילה — יש לסיים אותה';
    END IF;
    v_new_status := 'cancelled_by_manager'::public.break_request_status;
    v_action := 'cancel_manager';
  ELSE
    IF r.user_id <> v_actor THEN RAISE EXCEPTION 'אין הרשאה'; END IF;
    IF r.status NOT IN (
      'pending_approval'::public.break_request_status,
      'scheduled'::public.break_request_status,
      'waiting_for_start'::public.break_request_status,
      'approved'::public.break_request_status
    ) THEN
      RAISE EXCEPTION 'לא ניתן לבטל הפסקה במצב זה';
    END IF;
    v_new_status := 'cancelled_by_employee'::public.break_request_status;
    v_action := 'cancel_employee';
  END IF;

  UPDATE public.break_requests
     SET status = v_new_status,
         cancelled_by = v_actor,
         cancelled_by_name = v_actor_name,
         cancelled_at = now(),
         cancellation_reason = NULLIF(btrim(_reason), ''),
         last_modified_at = now()
   WHERE id = _id;

  PERFORM public.write_break_audit(_id, v_actor, r.user_id, v_action,
    jsonb_build_object(
      'reason', NULLIF(btrim(_reason), ''),
      'actor_name', v_actor_name,
      'cancelled_at_local', v_when
    ), r.branch_id);

  -- Notify employee only when a manager cancels their break
  IF v_is_manager AND r.user_id IS DISTINCT FROM v_actor THEN
    v_msg := format('ההפסקה שלך בוטלה על ידי %s · %s', v_actor_name, v_when);
    IF NULLIF(btrim(_reason), '') IS NOT NULL THEN
      v_msg := v_msg || ' · ' || btrim(_reason);
    END IF;
    BEGIN
      INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
      VALUES (r.user_id, NULL, v_msg, r.branch_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.manual_end_break(_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_end timestamptz := now();
  v_started timestamptz;
  v_fields record;
  v_manager_name text;
  v_when text;
  v_msg text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.can_manually_end_break(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לסיים הפסקה של עובד';
  END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'הפסקה לא נמצאה'; END IF;
  IF r.status <> 'active'::public.break_request_status THEN
    RAISE EXCEPTION 'ניתן לסיים ידנית רק הפסקה פעילה';
  END IF;

  v_manager_name := COALESCE(public.break_actor_display_name(v_actor), 'מנהל');
  v_when := to_char((v_end AT TIME ZONE 'Asia/Jerusalem'), 'DD.MM.YYYY HH24:MI');
  v_started := COALESCE(r.actual_start, r.started_at, r.planned_start, v_end);

  SELECT * INTO v_fields FROM public.compute_break_end_fields(
    r.planned_start, r.planned_duration, r.ends_at, v_started, v_end
  );

  UPDATE public.break_requests
     SET status = 'ended_by_manager'::public.break_request_status,
         started_at = v_started,
         actual_start = v_started,
         actual_end = v_end,
         completed_at = v_end,
         end_verified_by = v_actor,
         ending_verified_at = v_end,
         last_modified_at = v_end,
         actual_duration = v_fields.actual_duration,
         overtime_minutes = v_fields.overtime_minutes,
         ended_by = 'manager',
         ended_by_manager_id = v_actor,
         ended_by_manager_name = v_manager_name,
         end_notified_at = COALESCE(end_notified_at, v_end)
   WHERE id = _id;

  v_msg := format('ההפסקה שלך הסתיימה על ידי %s · %s', v_manager_name, v_when);
  IF NULLIF(btrim(_reason), '') IS NOT NULL THEN
    v_msg := v_msg || ' · ' || btrim(_reason);
  END IF;

  PERFORM public.write_break_audit(_id, v_actor, r.user_id, 'manual_end',
    jsonb_build_object(
      'message', v_msg,
      'reason', NULLIF(btrim(_reason), ''),
      'manager_name', v_manager_name,
      'ended_at_local', v_when,
      'actual_duration_minutes', v_fields.actual_duration,
      'overtime_minutes', v_fields.overtime_minutes
    ), r.branch_id);

  BEGIN
    INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
    VALUES (r.user_id, NULL, v_msg, r.branch_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_break_request(_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_msg text;
  v_actor_name text;
  v_when text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.can_approve_break_by_policy(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לדחות הפסקות';
  END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;
  IF r.status <> 'pending_approval'::public.break_request_status THEN
    RAISE EXCEPTION 'ניתן לדחות רק בקשות הממתינות לאישור';
  END IF;

  v_actor_name := COALESCE(public.break_actor_display_name(v_actor), 'מנהל');
  v_when := to_char((now() AT TIME ZONE 'Asia/Jerusalem'), 'DD.MM.YYYY HH24:MI');

  UPDATE public.break_requests
     SET status = 'rejected'::public.break_request_status,
         rejection_reason = NULLIF(btrim(_reason), ''),
         rejected_at = now(),
         rejected_by = v_actor,
         last_modified_at = now()
   WHERE id = _id;

  v_msg := format('בקשת ההפסקה נדחתה על ידי %s · %s', v_actor_name, v_when);
  IF NULLIF(btrim(_reason), '') IS NOT NULL THEN
    v_msg := v_msg || ' · ' || btrim(_reason);
  END IF;

  BEGIN
    INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
    VALUES (r.user_id, NULL, v_msg, r.branch_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM public.write_break_audit(_id, v_actor, r.user_id, 'reject',
    jsonb_build_object(
      'reason', NULLIF(btrim(_reason), ''),
      'actor_name', v_actor_name,
      'rejected_at_local', v_when
    ), r.branch_id);
END;
$$;

NOTIFY pgrst, 'reload schema';
