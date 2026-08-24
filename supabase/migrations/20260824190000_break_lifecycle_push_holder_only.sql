-- Break lifecycle push (start / end / late): holder-only.
-- Does NOT change roles, permissions, RLS, or who can approve/end breaks.
-- break_approval (managers) is unchanged.

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
  v_payload jsonb;
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

  IF NOT public.is_platform_push_enabled(_event_key, _branch_id) THEN
    RETURN;
  END IF;

  -- Always a single recipient. For break_start/end/late this is the break holder only.
  v_payload := jsonb_build_object(
    'userIds', jsonb_build_array(_user_id::text),
    'message', btrim(_message),
    'title', COALESCE(NULLIF(btrim(_title), ''), 'מערכת ניהול עובדים'),
    'tag', _event_key || '-' || _user_id::text || '-' || extract(epoch from now())::bigint::text,
    'url', '/dashboard',
    'eventKey', _event_key,
    'branchId', _branch_id
  );

  IF v_tone IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('tone', v_tone);
  END IF;

  PERFORM public.invoke_push_dispatch_hook(v_payload);
END;
$$;

COMMENT ON FUNCTION public.notify_with_platform_push(uuid, text, uuid, text, uuid, text) IS
  'In-app bell + optional push to exactly one user. Break start/end/late are holder-only; never fans out to managers.';

-- Clarify: break_end push is to the holder only (not managers).
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

  -- Holder-only push (break_end). Managers are not notified.
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
