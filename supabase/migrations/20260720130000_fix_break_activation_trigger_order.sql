-- Prevent after_insert / after_approve from downgrading breaks that activate_if_due
-- already promoted to active (PostgreSQL fires activate_if_due before after_* triggers).

CREATE OR REPLACE FUNCTION public.break_requests_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start text;
  v_msg text;
BEGIN
  PERFORM public.write_break_audit(
    NEW.id, NEW.user_id, NEW.user_id, 'created',
    jsonb_build_object(
      'planned_start', NEW.planned_start,
      'planned_duration', NEW.planned_duration,
      'status', NEW.status::text
    ),
    NEW.branch_id
  );

  v_start := to_char(NEW.planned_start AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI');

  IF NEW.status = 'scheduled'::public.break_request_status THEN
    v_msg := format('ההפסקה נקבעה בהצלחה. ההפסקה תתחיל אוטומטית בשעה %s.', v_start);
    BEGIN
      INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
      VALUES (NEW.user_id, NULL, v_msg, NEW.branch_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    UPDATE public.break_requests
       SET status = 'waiting_for_start'::public.break_request_status
     WHERE id = NEW.id
       AND status = 'scheduled'::public.break_request_status
       AND COALESCE(planned_start, requested_at) > now();
  ELSIF NEW.status = 'pending_approval'::public.break_request_status THEN
    PERFORM public.notify_break_approvers(NEW);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.break_requests_after_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start text;
  v_msg text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'approved'::public.break_request_status
  THEN
    v_start := to_char(COALESCE(NEW.approved_at_time, NEW.planned_start) AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI');
    v_msg := format('הבקשה אושרה. ההפסקה תתחיל בשעה %s.', v_start);
    BEGIN
      INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
      VALUES (NEW.user_id, NULL, v_msg, NEW.branch_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    UPDATE public.break_requests
       SET status = 'waiting_for_start'::public.break_request_status
     WHERE id = NEW.id
       AND status = 'approved'::public.break_request_status
       AND COALESCE(approved_at_time, planned_start, requested_at) > now();
  END IF;
  RETURN NULL;
END;
$$;
