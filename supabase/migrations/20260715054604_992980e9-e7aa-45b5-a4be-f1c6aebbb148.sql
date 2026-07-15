
-- 1) Rewrite BEFORE INSERT trigger: auto-approve when policy allows, but NEVER auto-activate.
CREATE OR REPLACE FUNCTION public.break_requests_apply_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.break_policy;
BEGIN
  -- Never trust client-supplied started_at / ends_at / active-status on insert.
  -- The break only starts when the scheduled time arrives (via activate_due_break_requests).
  NEW.started_at := NULL;
  NEW.ends_at := NULL;
  NEW.completed_at := NULL;
  NEW.completed_by := NULL;

  p := public.get_break_policy();

  IF p.requires_approval = false THEN
    -- Auto-approve; DO NOT activate. Activation happens at NEW.requested_at.
    NEW.status := 'approved';
    NEW.approved_at_time := COALESCE(NEW.approved_at_time, NEW.requested_at);
    NEW.approved_by := COALESCE(NEW.approved_by, NEW.user_id);
    NEW.approval_decided_at := COALESCE(NEW.approval_decided_at, now());
  ELSE
    -- Approval required: force pending regardless of what client sent.
    IF NEW.status NOT IN ('pending','cancelled') THEN
      NEW.status := 'pending';
    END IF;
    NEW.approved_at_time := NULL;
    NEW.approved_by := NULL;
    NEW.approval_decided_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- 2) Function that activates any due approved break requests.
--    Safe to call from pg_cron or from a client after an approval to activate immediately.
CREATE OR REPLACE FUNCTION public.activate_due_break_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_start timestamptz;
  v_dur int;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT *
    FROM public.break_requests
    WHERE status = 'approved'
      AND started_at IS NULL
      AND COALESCE(approved_at_time, requested_at) <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    v_start := COALESCE(r.approved_at_time, r.requested_at, now());
    v_dur := COALESCE(r.duration_minutes,
                      (SELECT duration_minutes FROM public.break_settings WHERE id = r.break_setting_id));

    UPDATE public.break_requests
       SET status = 'active',
           started_at = v_start,
           ends_at = v_start + make_interval(mins => COALESCE(v_dur, 15)),
           start_notified_at = COALESCE(start_notified_at, now())
     WHERE id = r.id;

    -- Notify the employee (in-app notification). schedule_id is nullable.
    BEGIN
      INSERT INTO public.schedule_notifications (user_id, schedule_id, message)
      VALUES (r.user_id, NULL, 'ההפסקה שלך התחילה');
    EXCEPTION WHEN OTHERS THEN
      -- Never let notification failure block activation.
      NULL;
    END;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_due_break_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_due_break_requests() TO authenticated, service_role;

-- 3) AFTER UPDATE trigger: when a request becomes approved AND its scheduled time
--    is already past, activate immediately on the same transaction. This handles
--    manager approving a request whose requested_at is now/past, without waiting
--    for the cron tick.
CREATE OR REPLACE FUNCTION public.break_requests_activate_if_due()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved'
     AND NEW.started_at IS NULL
     AND COALESCE(NEW.approved_at_time, NEW.requested_at) <= now()
  THEN
    PERFORM public.activate_due_break_requests();
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_break_requests_activate_if_due ON public.break_requests;
CREATE TRIGGER trg_break_requests_activate_if_due
  AFTER INSERT OR UPDATE OF status, approved_at_time, requested_at
  ON public.break_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.break_requests_activate_if_due();

-- 4) pg_cron job — every minute activate due breaks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'activate-due-break-requests') THEN
    PERFORM cron.unschedule('activate-due-break-requests');
  END IF;
  PERFORM cron.schedule(
    'activate-due-break-requests',
    '* * * * *',
    $CRON$ SELECT public.activate_due_break_requests(); $CRON$
  );
END $$;

-- 5) Realtime for break_requests (idempotent). Ignore if already added.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.break_requests';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.schedule_notifications';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
