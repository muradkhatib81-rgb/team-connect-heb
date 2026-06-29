
CREATE OR REPLACE FUNCTION public.process_break_lifecycle()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  -- approved -> active (start time reached)
  FOR r IN
    SELECT * FROM public.break_requests
    WHERE status = 'approved'
      AND approved_at_time IS NOT NULL
      AND approved_at_time <= now()
      AND start_notified_at IS NULL
  LOOP
    UPDATE public.break_requests
    SET status = 'active',
        started_at = COALESCE(started_at, r.approved_at_time),
        ends_at = COALESCE(ends_at, r.approved_at_time + (r.duration_minutes || ' minutes')::interval),
        start_notified_at = now()
    WHERE id = r.id;

    INSERT INTO public.schedule_notifications (schedule_id, user_id, message)
    VALUES (NULL, r.user_id, 'ההפסקה שלך מתחילה עכשיו.');
  END LOOP;

  -- active -> ending soon (<=1 min to end)
  FOR r IN
    SELECT * FROM public.break_requests
    WHERE status = 'active'
      AND ends_at IS NOT NULL
      AND ends_at - interval '1 minute' <= now()
      AND ends_at > now()
      AND ending_notified_at IS NULL
  LOOP
    UPDATE public.break_requests SET ending_notified_at = now() WHERE id = r.id;
    INSERT INTO public.schedule_notifications (schedule_id, user_id, message)
    VALUES (NULL, r.user_id, 'ההפסקה שלך מסתיימת בעוד דקה.');
  END LOOP;

  -- active past end time -> notify ONCE about overrun, but do NOT auto-complete.
  -- The break stays "active" until the employee taps "חזרתי מהפסקה".
  FOR r IN
    SELECT * FROM public.break_requests
    WHERE status = 'active'
      AND ends_at IS NOT NULL
      AND ends_at <= now()
      AND end_notified_at IS NULL
  LOOP
    UPDATE public.break_requests
    SET end_notified_at = now()
    WHERE id = r.id;

    INSERT INTO public.schedule_notifications (schedule_id, user_id, message)
    VALUES (NULL, r.user_id, 'זמן ההפסקה הסתיים. אנא לחץ/י על "חזרתי מהפסקה" כשתחזור/חזרת.');
  END LOOP;
END;
$function$;
