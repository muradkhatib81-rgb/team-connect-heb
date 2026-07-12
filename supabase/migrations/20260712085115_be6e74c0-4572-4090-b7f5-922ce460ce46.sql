CREATE OR REPLACE FUNCTION public.break_requests_apply_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.break_policy;
  v_dur int;
  v_start timestamptz;
BEGIN
  p := public.get_break_policy();
  IF p.requires_approval = false AND NEW.status IN ('pending','approved') THEN
    v_start := COALESCE(NEW.started_at, NEW.approved_at_time, NEW.requested_at, now());
    NEW.status := 'active';
    NEW.approved_at_time := COALESCE(NEW.approved_at_time, v_start);
    NEW.approved_by := COALESCE(NEW.approved_by, NEW.user_id);
    NEW.approval_decided_at := COALESCE(NEW.approval_decided_at, now());
    NEW.started_at := v_start;
    IF NEW.ends_at IS NULL THEN
      v_dur := COALESCE(NEW.duration_minutes,
                        (SELECT duration_minutes FROM public.break_settings WHERE id = NEW.break_setting_id));
      IF v_dur IS NOT NULL THEN
        NEW.ends_at := v_start + make_interval(mins => v_dur);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;