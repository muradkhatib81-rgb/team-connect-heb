-- Wire break_end push + pass tone hints for strong break alerts.
-- Also align per-user break activation with platform push helper.

CREATE OR REPLACE FUNCTION public.notify_with_platform_push(
  _user_id uuid,
  _message text,
  _branch_id uuid,
  _event_key text,
  _schedule_id uuid DEFAULT NULL,
  _title text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tone text;
BEGIN
  IF _user_id IS NULL OR NULLIF(btrim(_message), '') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
    VALUES (_user_id, _schedule_id, btrim(_message), _branch_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  v_tone := CASE _event_key
    WHEN 'break_start' THEN 'break_start'
    WHEN 'break_end' THEN 'break_end'
    WHEN 'break_late' THEN 'break_late'
    ELSE NULL
  END;

  IF public.is_platform_push_enabled(_event_key, _branch_id) THEN
    PERFORM public.invoke_push_dispatch_hook(jsonb_build_object(
      'userIds', jsonb_build_array(_user_id::text),
      'message', btrim(_message),
      'title', COALESCE(NULLIF(btrim(_title), ''), 'מערכת ניהול עובדים'),
      'tag', _event_key || '-' || _user_id::text || '-' || extract(epoch from now())::bigint::text,
      'url', '/dashboard',
      'tone', to_jsonb(v_tone)
    ));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_my_break(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_end timestamptz := now();
  v_fields record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;
  IF r.user_id <> auth.uid() THEN RAISE EXCEPTION 'אין הרשאה'; END IF;
  IF r.status <> 'active'::public.break_request_status THEN
    RAISE EXCEPTION 'אין הפסקה פעילה לסיום';
  END IF;

  SELECT * INTO v_fields FROM public.compute_break_end_fields(
    r.planned_start, r.planned_duration, r.ends_at,
    COALESCE(r.actual_start, r.started_at, now()), v_end
  );

  UPDATE public.break_requests
     SET status = 'completed'::public.break_request_status,
         started_at = COALESCE(started_at, actual_start, now()),
         actual_start = COALESCE(actual_start, started_at, now()),
         actual_end = v_end,
         completed_at = v_end,
         end_verified_by = auth.uid(),
         ending_verified_at = v_end,
         last_modified_at = v_end,
         actual_duration = v_fields.actual_duration,
         overtime_minutes = v_fields.overtime_minutes,
         ended_by = 'employee',
         end_notified_at = COALESCE(end_notified_at, v_end)
   WHERE id = _id;

  PERFORM public.write_break_audit(_id, auth.uid(), r.user_id, 'completed',
    jsonb_build_object(
      'actual_duration', v_fields.actual_duration,
      'overtime_minutes', v_fields.overtime_minutes
    ), r.branch_id);

  -- Notify the holder (and managers listening via same event) — strong break_end tone.
  PERFORM public.notify_with_platform_push(
    r.user_id,
    'ההפסקה הסתיימה — נא לחזור לעבודה',
    r.branch_id,
    'break_end',
    NULL,
    'סיום הפסקה'
  );
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

  PERFORM public.notify_with_platform_push(
    r.user_id,
    v_msg,
    r.branch_id,
    'break_end',
    NULL,
    'סיום הפסקה'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_due_breaks_for_user(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_start timestamptz;
  v_dur int;
BEGIN
  IF _user_id IS NULL THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.break_requests
    WHERE user_id = _user_id
      AND status = 'active'::public.break_request_status
  ) THEN
    RETURN 0;
  END IF;

  SELECT *
    INTO r
    FROM public.break_requests
   WHERE user_id = _user_id
     AND status IN (
       'scheduled'::public.break_request_status,
       'approved'::public.break_request_status,
       'waiting_for_start'::public.break_request_status
     )
     AND started_at IS NULL
     AND COALESCE(planned_start, approved_at_time, requested_at) <= now()
   ORDER BY COALESCE(planned_start, approved_at_time, requested_at) ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_start := now();
  v_dur := COALESCE(r.planned_duration, r.duration_minutes,
    (SELECT duration_minutes FROM public.break_settings WHERE id = r.break_setting_id));

  UPDATE public.break_requests
     SET status = 'active'::public.break_request_status,
         started_at = v_start,
         actual_start = v_start,
         ends_at = v_start + make_interval(mins => COALESCE(v_dur, 15)),
         start_notified_at = COALESCE(start_notified_at, now()),
         last_modified_at = now()
   WHERE id = r.id;

  PERFORM public.write_break_audit(
    r.id, r.user_id, COALESCE(auth.uid(), r.user_id), 'started',
    jsonb_build_object('started_at', v_start, 'ends_at', v_start + make_interval(mins => COALESCE(v_dur, 15))),
    r.branch_id
  );

  PERFORM public.notify_with_platform_push(
    r.user_id,
    'ההפסקה שלך התחילה',
    r.branch_id,
    'break_start',
    NULL,
    'הפסקה'
  );

  RETURN 1;
END;
$$;
