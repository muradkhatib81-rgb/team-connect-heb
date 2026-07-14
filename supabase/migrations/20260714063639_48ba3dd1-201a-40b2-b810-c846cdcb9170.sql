CREATE OR REPLACE FUNCTION public.guard_manual_break_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'active'
     AND NEW.status = 'completed'
     AND OLD.user_id IS DISTINCT FROM v_actor
     AND v_actor IS NOT NULL
     AND NOT public.can_manually_end_break(v_actor)
  THEN
    RAISE EXCEPTION 'אין הרשאה לסיים הפסקה של עובד';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_manual_break_completion ON public.break_requests;
CREATE TRIGGER trg_guard_manual_break_completion
  BEFORE UPDATE ON public.break_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_manual_break_completion();