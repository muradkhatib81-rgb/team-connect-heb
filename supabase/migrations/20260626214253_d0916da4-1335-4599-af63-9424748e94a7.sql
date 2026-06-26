
CREATE OR REPLACE FUNCTION public.reset_breaks_log_daily()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jerusalem_today date;
BEGIN
  jerusalem_today := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  -- Delete all break request records not belonging to current Jerusalem day.
  DELETE FROM public.break_requests
  WHERE (COALESCE(created_at, now()) AT TIME ZONE 'Asia/Jerusalem')::date < jerusalem_today;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reset_breaks_log_daily() FROM PUBLIC, anon, authenticated;
