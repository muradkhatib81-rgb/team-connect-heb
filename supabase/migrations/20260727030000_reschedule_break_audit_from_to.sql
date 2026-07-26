-- Enrich reschedule audit payload with old→new times for the break journal.
-- No permission / RLS / role changes.

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
  v_old_start timestamptz;
  v_old_dur integer;
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

  v_old_start := COALESCE(r.planned_start, r.requested_at);
  v_old_dur := COALESCE(r.planned_duration, r.duration_minutes);
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

  PERFORM public.write_break_audit(
    _id,
    v_actor,
    r.user_id,
    'reschedule',
    jsonb_build_object(
      'old_start', v_old_start,
      'new_start', _new_start,
      'old_duration', v_old_dur,
      'new_duration', v_dur
    ),
    r.branch_id
  );

  IF v_is_manager AND r.status = 'pending_approval'::public.break_request_status THEN
    PERFORM public.approve_break_request(_id, _new_start);
  END IF;
END;
$$;
