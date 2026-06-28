CREATE OR REPLACE FUNCTION public.end_my_break(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;
  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'בקשה לא נמצאה';
  END IF;
  IF r.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'אין הרשאה';
  END IF;
  IF r.status NOT IN ('approved','active') THEN
    RAISE EXCEPTION 'אין הפסקה פעילה לסיום';
  END IF;
  UPDATE public.break_requests
     SET status = 'completed',
         started_at = COALESCE(started_at, approved_at_time, now()),
         completed_at = now(),
         end_notified_at = COALESCE(end_notified_at, now())
   WHERE id = _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_my_break(uuid) TO authenticated;