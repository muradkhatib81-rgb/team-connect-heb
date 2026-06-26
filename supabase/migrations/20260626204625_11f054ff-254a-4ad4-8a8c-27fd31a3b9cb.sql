
-- 1. Allow schedule_notifications.schedule_id to be NULL so we can reuse this table for break notifications
ALTER TABLE public.schedule_notifications
  ALTER COLUMN schedule_id DROP NOT NULL;

-- 2. Break requests table
CREATE TABLE IF NOT EXISTS public.break_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  break_setting_id uuid NOT NULL REFERENCES public.break_settings(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL,
  approved_at_time timestamptz,
  duration_minutes integer NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | active | completed | cancelled
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approval_decided_at timestamptz,
  started_at timestamptz,
  ends_at timestamptz,
  completed_at timestamptz,
  start_notified_at timestamptz,
  ending_notified_at timestamptz,
  end_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_break_requests_user ON public.break_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_break_requests_status ON public.break_requests(status);
CREATE INDEX IF NOT EXISTS idx_break_requests_dept ON public.break_requests(department_id);
CREATE INDEX IF NOT EXISTS idx_break_requests_approved_time ON public.break_requests(approved_at_time);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.break_requests TO authenticated;
GRANT ALL ON public.break_requests TO service_role;
ALTER TABLE public.break_requests ENABLE ROW LEVEL SECURITY;

-- Own row visible/insertable
CREATE POLICY "Users view their own break requests"
  ON public.break_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert their own break requests"
  ON public.break_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

-- User can cancel their own pending request
CREATE POLICY "Users cancel their own pending break"
  ON public.break_requests FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status IN ('pending','cancelled'));

-- Approvers (main_admin or can_manage_breaks) view & manage all
CREATE POLICY "Break managers view all"
  ON public.break_requests FOR SELECT TO authenticated
  USING (public.has_break_manage_perm(auth.uid()));

CREATE POLICY "Break managers update all"
  ON public.break_requests FOR UPDATE TO authenticated
  USING (public.has_break_manage_perm(auth.uid()))
  WITH CHECK (public.has_break_manage_perm(auth.uid()));

CREATE POLICY "Break managers delete"
  ON public.break_requests FOR DELETE TO authenticated
  USING (public.has_break_manage_perm(auth.uid()));

CREATE TRIGGER trg_break_requests_updated_at
  BEFORE UPDATE ON public.break_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.break_requests;

-- 4. Lifecycle processor — runs every minute via pg_cron
CREATE OR REPLACE FUNCTION public.process_break_lifecycle()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- active -> completed
  FOR r IN
    SELECT * FROM public.break_requests
    WHERE status = 'active'
      AND ends_at IS NOT NULL
      AND ends_at <= now()
      AND end_notified_at IS NULL
  LOOP
    UPDATE public.break_requests
    SET status = 'completed',
        completed_at = now(),
        end_notified_at = now()
    WHERE id = r.id;

    INSERT INTO public.schedule_notifications (schedule_id, user_id, message)
    VALUES (NULL, r.user_id, 'זמן ההפסקה הסתיים. נא לחזור לעבודה.');
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.process_break_lifecycle() FROM PUBLIC, anon, authenticated;

-- 5. Schedule it every minute
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-break-lifecycle') THEN
    PERFORM cron.unschedule('process-break-lifecycle');
  END IF;
  PERFORM cron.schedule(
    'process-break-lifecycle',
    '* * * * *',
    $cron$ SELECT public.process_break_lifecycle(); $cron$
  );
END $$;
