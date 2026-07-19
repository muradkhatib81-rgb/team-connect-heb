-- Scheduled break workflow: explicit states, audit fields, approval/rejection RPCs.

-- 1) Status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'break_request_status') THEN
    CREATE TYPE public.break_request_status AS ENUM (
      'scheduled',
      'pending_approval',
      'approved',
      'waiting_for_start',
      'active',
      'completed',
      'rejected',
      'ended_by_manager',
      'cancelled'
    );
  END IF;
END $$;

-- 2) Additive columns
ALTER TABLE public.break_requests
  ADD COLUMN IF NOT EXISTS planned_start timestamptz,
  ADD COLUMN IF NOT EXISTS actual_start timestamptz,
  ADD COLUMN IF NOT EXISTS actual_end timestamptz,
  ADD COLUMN IF NOT EXISTS planned_duration integer,
  ADD COLUMN IF NOT EXISTS actual_duration integer,
  ADD COLUMN IF NOT EXISTS overtime_minutes integer,
  ADD COLUMN IF NOT EXISTS ended_by text CHECK (ended_by IS NULL OR ended_by IN ('employee', 'manager')),
  ADD COLUMN IF NOT EXISTS ended_by_manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ended_by_manager_name text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3) Backfill from legacy columns
UPDATE public.break_requests
SET
  planned_start = COALESCE(planned_start, requested_at),
  planned_duration = COALESCE(planned_duration, duration_minutes),
  actual_start = COALESCE(actual_start, started_at),
  actual_end = COALESCE(actual_end, completed_at)
WHERE planned_start IS NULL OR planned_duration IS NULL;

UPDATE public.break_requests
SET actual_duration = GREATEST(
  0,
  CEIL(EXTRACT(EPOCH FROM (actual_end - actual_start)) / 60.0)::integer
)
WHERE actual_end IS NOT NULL
  AND actual_start IS NOT NULL
  AND actual_duration IS NULL;

UPDATE public.break_requests
SET overtime_minutes = GREATEST(
  0,
  CEIL(EXTRACT(EPOCH FROM (actual_end - ends_at)) / 60.0)::integer
)
WHERE actual_end IS NOT NULL
  AND ends_at IS NOT NULL
  AND actual_end > ends_at
  AND overtime_minutes IS NULL;

UPDATE public.break_requests br
SET
  status = 'ended_by_manager',
  ended_by = 'manager',
  ended_by_manager_id = bal.actor_id,
  ended_by_manager_name = COALESCE(p.full_name, 'מנהל')
FROM public.break_audit_log bal
LEFT JOIN public.profiles p ON p.id = bal.actor_id
WHERE bal.break_request_id = br.id
  AND bal.action = 'manual_end'
  AND br.status = 'completed'
  AND br.ended_by IS NULL;

UPDATE public.break_requests
SET
  ended_by = 'employee',
  status = CASE WHEN status = 'completed' THEN 'completed'::text ELSE status END
WHERE status = 'completed'
  AND ended_by IS NULL
  AND completed_at IS NOT NULL;

-- 4) Migrate legacy text statuses before type conversion
UPDATE public.break_requests SET status = 'pending_approval' WHERE status = 'pending';

UPDATE public.break_requests
SET status = 'waiting_for_start'
WHERE status = 'approved'
  AND started_at IS NULL;

UPDATE public.break_requests
SET status = 'active'
WHERE status = 'approved'
  AND started_at IS NOT NULL;

-- 5) Convert status column to enum (via text cast)
ALTER TABLE public.break_requests
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.break_requests
  ALTER COLUMN status TYPE public.break_request_status
  USING (
    CASE status
      WHEN 'scheduled' THEN 'scheduled'::public.break_request_status
      WHEN 'pending_approval' THEN 'pending_approval'::public.break_request_status
      WHEN 'approved' THEN 'approved'::public.break_request_status
      WHEN 'waiting_for_start' THEN 'waiting_for_start'::public.break_request_status
      WHEN 'active' THEN 'active'::public.break_request_status
      WHEN 'completed' THEN 'completed'::public.break_request_status
      WHEN 'rejected' THEN 'rejected'::public.break_request_status
      WHEN 'ended_by_manager' THEN 'ended_by_manager'::public.break_request_status
      WHEN 'cancelled' THEN 'cancelled'::public.break_request_status
      ELSE 'pending_approval'::public.break_request_status
    END
  );

ALTER TABLE public.break_requests
  ALTER COLUMN status SET DEFAULT 'pending_approval'::public.break_request_status;

-- 6) Expand audit log actions
ALTER TABLE public.break_audit_log DROP CONSTRAINT IF EXISTS break_audit_log_action_check;
ALTER TABLE public.break_audit_log
  ADD CONSTRAINT break_audit_log_action_check
  CHECK (action IN ('manual_end', 'reject', 'approve'));

-- 7) Helper: notify break approvers
CREATE OR REPLACE FUNCTION public.notify_break_approvers(_req public.break_requests)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee text;
  v_break_type text;
  v_start text;
  v_msg text;
  v_uid uuid;
BEGIN
  SELECT COALESCE(p.full_name, 'עובד') INTO v_employee
  FROM public.profiles p WHERE p.id = _req.user_id;

  SELECT COALESCE(bs.name, 'הפסקה') INTO v_break_type
  FROM public.break_settings bs WHERE bs.id = _req.break_setting_id;

  v_start := to_char(
    COALESCE(_req.planned_start, _req.requested_at) AT TIME ZONE 'Asia/Jerusalem',
    'HH24:MI'
  );

  v_msg := format(
    'בקשת הפסקה חדשה: %s · %s · התחלה %s · %s דק׳',
    v_employee,
    v_break_type,
    v_start,
    COALESCE(_req.planned_duration, _req.duration_minutes)
  );

  FOR v_uid IN
    SELECT DISTINCT u.id
    FROM auth.users u
    JOIN public.profiles pr ON pr.id = u.id
    WHERE pr.is_active IS DISTINCT FROM false
      AND public.can_approve_break_by_policy(u.id)
      AND u.id <> _req.user_id
  LOOP
    BEGIN
      INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
      VALUES (v_uid, NULL, v_msg, _req.branch_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_break_approvers(public.break_requests) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_break_approvers(public.break_requests) TO service_role;

-- 8) Helper: finalize break end fields
CREATE OR REPLACE FUNCTION public.compute_break_end_fields(
  _planned_start timestamptz,
  _planned_duration integer,
  _ends_at timestamptz,
  _actual_start timestamptz,
  _actual_end timestamptz
)
RETURNS TABLE(actual_duration integer, overtime_minutes integer)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN _actual_start IS NULL OR _actual_end IS NULL THEN NULL
      ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (_actual_end - _actual_start)) / 60.0)::integer)
    END,
    CASE
      WHEN _ends_at IS NULL OR _actual_end IS NULL THEN 0
      WHEN _actual_end <= _ends_at THEN 0
      ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (_actual_end - _ends_at)) / 60.0)::integer)
    END;
$$;

-- 9) BEFORE INSERT policy trigger
CREATE OR REPLACE FUNCTION public.break_requests_apply_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.break_policy;
BEGIN
  NEW.planned_start := COALESCE(NEW.planned_start, NEW.requested_at);
  NEW.planned_duration := COALESCE(NEW.planned_duration, NEW.duration_minutes);
  NEW.requested_at := NEW.planned_start;

  NEW.started_at := NULL;
  NEW.ends_at := NULL;
  NEW.completed_at := NULL;
  NEW.completed_by := NULL;
  NEW.actual_start := NULL;
  NEW.actual_end := NULL;
  NEW.actual_duration := NULL;
  NEW.overtime_minutes := NULL;
  NEW.ended_by := NULL;
  NEW.ended_by_manager_id := NULL;
  NEW.ended_by_manager_name := NULL;

  p := public.get_break_policy();

  IF p.requires_approval = false THEN
    NEW.status := 'scheduled'::public.break_request_status;
    NEW.approved_at_time := COALESCE(NEW.approved_at_time, NEW.planned_start);
    NEW.approved_by := COALESCE(NEW.approved_by, NEW.user_id);
    NEW.approval_decided_at := COALESCE(NEW.approval_decided_at, now());
  ELSE
    NEW.status := 'pending_approval'::public.break_request_status;
    NEW.approved_at_time := NULL;
    NEW.approved_by := NULL;
    NEW.approval_decided_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- 10) AFTER INSERT notifications + promote scheduled → waiting_for_start
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
     WHERE id = NEW.id;
  ELSIF NEW.status = 'pending_approval'::public.break_request_status THEN
    PERFORM public.notify_break_approvers(NEW);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_break_requests_after_insert ON public.break_requests;
CREATE TRIGGER trg_break_requests_after_insert
  AFTER INSERT ON public.break_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.break_requests_after_insert();

-- 11) Promote approved → waiting_for_start
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
    v_msg := format('בקשת ההפסקה אושרה. ההפסקה תתחיל בשעה %s.', v_start);
    BEGIN
      INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
      VALUES (NEW.user_id, NULL, v_msg, NEW.branch_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    UPDATE public.break_requests
       SET status = 'waiting_for_start'::public.break_request_status
     WHERE id = NEW.id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_break_requests_after_approve ON public.break_requests;
CREATE TRIGGER trg_break_requests_after_approve
  AFTER UPDATE OF status ON public.break_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.break_requests_after_approve();

-- 12) Activate due breaks
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
    WHERE status IN (
      'scheduled'::public.break_request_status,
      'approved'::public.break_request_status,
      'waiting_for_start'::public.break_request_status
    )
      AND started_at IS NULL
      AND COALESCE(planned_start, approved_at_time, requested_at) <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    v_start := now();
    v_dur := COALESCE(r.planned_duration, r.duration_minutes,
                      (SELECT duration_minutes FROM public.break_settings WHERE id = r.break_setting_id));

    UPDATE public.break_requests
       SET status = 'active'::public.break_request_status,
           started_at = v_start,
           actual_start = v_start,
           ends_at = v_start + make_interval(mins => COALESCE(v_dur, 15)),
           start_notified_at = COALESCE(start_notified_at, now())
     WHERE id = r.id;

    BEGIN
      INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
      VALUES (r.user_id, NULL, 'ההפסקה שלך התחילה', r.branch_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 13) Activate-if-due trigger (post-approval / reschedule)
CREATE OR REPLACE FUNCTION public.break_requests_activate_if_due()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN (
       'scheduled'::public.break_request_status,
       'approved'::public.break_request_status,
       'waiting_for_start'::public.break_request_status
     )
     AND NEW.started_at IS NULL
     AND COALESCE(NEW.planned_start, NEW.approved_at_time, NEW.requested_at) <= now()
  THEN
    PERFORM public.activate_due_break_requests();
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_break_requests_activate_if_due ON public.break_requests;
CREATE TRIGGER trg_break_requests_activate_if_due
  AFTER INSERT OR UPDATE OF status, approved_at_time, requested_at, planned_start
  ON public.break_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.break_requests_activate_if_due();

-- 14) Approve RPC
CREATE OR REPLACE FUNCTION public.approve_break_request(
  _id uuid,
  _approved_at_time timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_time timestamptz;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;
  IF NOT public.can_approve_break_by_policy(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לאשר הפסקות';
  END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'בקשה לא נמצאה';
  END IF;
  IF r.status <> 'pending_approval'::public.break_request_status THEN
    RAISE EXCEPTION 'ניתן לאשר רק בקשות הממתינות לאישור';
  END IF;

  v_time := COALESCE(_approved_at_time, r.planned_start, r.requested_at);

  UPDATE public.break_requests
     SET status = 'approved'::public.break_request_status,
         approved_at_time = v_time,
         planned_start = v_time,
         requested_at = v_time,
         approved_by = v_actor,
         approval_decided_at = now()
   WHERE id = _id;

  INSERT INTO public.break_audit_log (break_request_id, actor_id, target_user_id, action, payload, branch_id)
  VALUES (
    _id,
    v_actor,
    r.user_id,
    'approve',
    jsonb_build_object('approved_at_time', v_time),
    r.branch_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_break_request(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_break_request(uuid, timestamptz) TO authenticated, service_role;

-- 15) Reject RPC
CREATE OR REPLACE FUNCTION public.reject_break_request(
  _id uuid,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_msg text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;
  IF NOT public.can_approve_break_by_policy(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לדחות הפסקות';
  END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'בקשה לא נמצאה';
  END IF;
  IF r.status <> 'pending_approval'::public.break_request_status THEN
    RAISE EXCEPTION 'ניתן לדחות רק בקשות הממתינות לאישור';
  END IF;

  UPDATE public.break_requests
     SET status = 'rejected'::public.break_request_status,
         rejection_reason = NULLIF(btrim(_reason), ''),
         rejected_at = now(),
         rejected_by = v_actor
   WHERE id = _id;

  v_msg := 'בקשת ההפסקה נדחתה';
  IF NULLIF(btrim(_reason), '') IS NOT NULL THEN
    v_msg := v_msg || ': ' || btrim(_reason);
  END IF;

  BEGIN
    INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
    VALUES (r.user_id, NULL, v_msg, r.branch_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  INSERT INTO public.break_audit_log (break_request_id, actor_id, target_user_id, action, payload, branch_id)
  VALUES (
    _id,
    v_actor,
    r.user_id,
    'reject',
    jsonb_build_object('reason', NULLIF(btrim(_reason), '')),
    r.branch_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_break_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_break_request(uuid, text) TO authenticated, service_role;

-- 16) Employee end break
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
  IF r.status <> 'active'::public.break_request_status THEN
    RAISE EXCEPTION 'אין הפסקה פעילה לסיום';
  END IF;

  SELECT * INTO v_fields
  FROM public.compute_break_end_fields(
    r.planned_start,
    r.planned_duration,
    r.ends_at,
    COALESCE(r.actual_start, r.started_at, now()),
    v_end
  );

  UPDATE public.break_requests
     SET status = 'completed'::public.break_request_status,
         started_at = COALESCE(started_at, actual_start, now()),
         actual_start = COALESCE(actual_start, started_at, now()),
         actual_end = v_end,
         completed_at = v_end,
         completed_by = auth.uid(),
         actual_duration = v_fields.actual_duration,
         overtime_minutes = v_fields.overtime_minutes,
         ended_by = 'employee',
         end_notified_at = COALESCE(end_notified_at, v_end)
   WHERE id = _id;
END;
$$;

-- 17) Manager force return
CREATE OR REPLACE FUNCTION public.manual_end_break(
  _id uuid,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_end timestamptz := now();
  v_started timestamptz;
  v_fields record;
  v_manager_name text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;
  IF NOT public.can_manually_end_break(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לסיים הפסקה של עובד';
  END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפסקה לא נמצאה';
  END IF;
  IF r.status <> 'active'::public.break_request_status THEN
    RAISE EXCEPTION 'ניתן לסיים ידנית רק הפסקה פעילה';
  END IF;

  SELECT COALESCE(p.full_name, 'מנהל') INTO v_manager_name
  FROM public.profiles p WHERE p.id = v_actor;

  v_started := COALESCE(r.actual_start, r.started_at, r.planned_start, v_end);

  SELECT * INTO v_fields
  FROM public.compute_break_end_fields(
    r.planned_start,
    r.planned_duration,
    r.ends_at,
    v_started,
    v_end
  );

  UPDATE public.break_requests
     SET status = 'ended_by_manager'::public.break_request_status,
         started_at = v_started,
         actual_start = v_started,
         actual_end = v_end,
         completed_at = v_end,
         completed_by = v_actor,
         actual_duration = v_fields.actual_duration,
         overtime_minutes = v_fields.overtime_minutes,
         ended_by = 'manager',
         ended_by_manager_id = v_actor,
         ended_by_manager_name = v_manager_name,
         end_notified_at = COALESCE(end_notified_at, v_end)
   WHERE id = _id;

  INSERT INTO public.break_audit_log (
    break_request_id,
    actor_id,
    target_user_id,
    action,
    payload,
    branch_id
  ) VALUES (
    _id,
    v_actor,
    r.user_id,
    'manual_end',
    jsonb_build_object(
      'message', 'ההפסקה הסתיימה על ידי מנהל',
      'reason', NULLIF(btrim(_reason), ''),
      'manager_id', v_actor,
      'manager_name', v_manager_name,
      'ended_at', v_end,
      'actual_duration_minutes', v_fields.actual_duration,
      'overtime_minutes', v_fields.overtime_minutes
    ),
    r.branch_id
  );

  BEGIN
    INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
    VALUES (r.user_id, NULL, 'ההפסקה הסתיימה על ידי מנהל', r.branch_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_break_by_manager(_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.manual_end_break(_id, _reason);
$$;

REVOKE EXECUTE ON FUNCTION public.manual_end_break(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_end_break(uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.end_break_by_manager(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_break_by_manager(uuid, text) TO authenticated, service_role;

-- 18) Guard manual completion for ended_by_manager status
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
     AND OLD.status = 'active'::public.break_request_status
     AND NEW.status IN (
       'completed'::public.break_request_status,
       'ended_by_manager'::public.break_request_status
     )
     AND OLD.user_id IS DISTINCT FROM v_actor
     AND v_actor IS NOT NULL
     AND NOT public.can_manually_end_break(v_actor)
  THEN
    RAISE EXCEPTION 'אין הרשאה לסיים הפסקה של עובד';
  END IF;
  RETURN NEW;
END;
$$;

-- 19) User cancel policy for new statuses
DROP POLICY IF EXISTS "Users cancel their own pending break" ON public.break_requests;
CREATE POLICY "Users cancel their own pending break"
  ON public.break_requests
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND status IN (
      'pending_approval'::public.break_request_status,
      'scheduled'::public.break_request_status,
      'waiting_for_start'::public.break_request_status
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'cancelled'::public.break_request_status
  );

-- 20) Disable legacy auto-complete lifecycle (no auto-end on overtime)
CREATE OR REPLACE FUNCTION public.process_break_lifecycle()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.activate_due_break_requests();
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-break-lifecycle') THEN
    PERFORM cron.unschedule('process-break-lifecycle');
  END IF;
END $$;
