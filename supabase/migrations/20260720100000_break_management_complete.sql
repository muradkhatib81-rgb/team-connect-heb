-- Complete break management: multiple planned breaks, validation, audit, cancel flows.
-- Additive only — never deletes break_requests rows.

-- ---------------------------------------------------------------------------
-- 1) Status enum (create or extend)
-- ---------------------------------------------------------------------------
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
      'cancelled',
      'cancelled_by_employee',
      'cancelled_by_manager'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'break_request_status' AND e.enumlabel = 'cancelled_by_employee'
  ) THEN
    ALTER TYPE public.break_request_status ADD VALUE IF NOT EXISTS 'cancelled_by_employee';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'break_request_status' AND e.enumlabel = 'cancelled_by_manager'
  ) THEN
    ALTER TYPE public.break_request_status ADD VALUE IF NOT EXISTS 'cancelled_by_manager';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Additive columns
-- ---------------------------------------------------------------------------
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
  ADD COLUMN IF NOT EXISTS end_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ending_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE public.break_requests DROP COLUMN IF EXISTS completed_by;

UPDATE public.break_requests
SET
  planned_start = COALESCE(planned_start, requested_at),
  planned_duration = COALESCE(planned_duration, duration_minutes),
  actual_start = COALESCE(actual_start, started_at),
  actual_end = COALESCE(actual_end, completed_at),
  last_modified_at = COALESCE(last_modified_at, updated_at, created_at)
WHERE planned_start IS NULL OR planned_duration IS NULL OR last_modified_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3) Migrate text statuses → enum
-- ---------------------------------------------------------------------------
UPDATE public.break_requests SET status = 'pending_approval' WHERE status::text = 'pending';

UPDATE public.break_requests
SET status = 'waiting_for_start'
WHERE status::text = 'approved' AND started_at IS NULL;

UPDATE public.break_requests
SET status = 'active'
WHERE status::text = 'approved' AND started_at IS NOT NULL;

-- Policies and triggers referencing status must be dropped before type conversion
DROP POLICY IF EXISTS "Users cancel their own pending break" ON public.break_requests;
DROP POLICY IF EXISTS "Users cancel own future breaks" ON public.break_requests;
DROP TRIGGER IF EXISTS trg_break_requests_activate_if_due ON public.break_requests;
DROP TRIGGER IF EXISTS trg_break_requests_after_approve ON public.break_requests;
DROP TRIGGER IF EXISTS trg_guard_manual_break_completion ON public.break_requests;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'break_requests'
      AND column_name = 'status' AND udt_name <> 'break_request_status'
  ) THEN
    ALTER TABLE public.break_requests ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE public.break_requests
      ALTER COLUMN status TYPE public.break_request_status
      USING (
        CASE status::text
          WHEN 'scheduled' THEN 'scheduled'::public.break_request_status
          WHEN 'pending_approval' THEN 'pending_approval'::public.break_request_status
          WHEN 'approved' THEN 'approved'::public.break_request_status
          WHEN 'waiting_for_start' THEN 'waiting_for_start'::public.break_request_status
          WHEN 'active' THEN 'active'::public.break_request_status
          WHEN 'completed' THEN 'completed'::public.break_request_status
          WHEN 'rejected' THEN 'rejected'::public.break_request_status
          WHEN 'ended_by_manager' THEN 'ended_by_manager'::public.break_request_status
          WHEN 'cancelled' THEN 'cancelled'::public.break_request_status
          WHEN 'cancelled_by_employee' THEN 'cancelled_by_employee'::public.break_request_status
          WHEN 'cancelled_by_manager' THEN 'cancelled_by_manager'::public.break_request_status
          ELSE 'pending_approval'::public.break_request_status
        END
      );
    ALTER TABLE public.break_requests
      ALTER COLUMN status SET DEFAULT 'pending_approval'::public.break_request_status;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Audit log — expand actions, never delete
-- ---------------------------------------------------------------------------
ALTER TABLE public.break_audit_log DROP CONSTRAINT IF EXISTS break_audit_log_action_check;
ALTER TABLE public.break_audit_log
  ADD CONSTRAINT break_audit_log_action_check
  CHECK (action IN (
    'created', 'approve', 'reject', 'reschedule', 'started', 'completed',
    'cancel', 'cancel_employee', 'cancel_manager', 'manual_end'
  ));

REVOKE DELETE ON public.break_audit_log FROM authenticated;
REVOKE DELETE ON public.break_requests FROM authenticated;
DROP POLICY IF EXISTS "Break managers delete" ON public.break_requests;

CREATE OR REPLACE FUNCTION public.break_requests_deny_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'אין אפשרות למחוק בקשות הפסקה — ניתן לבטל בלבד';
END;
$$;

DROP TRIGGER IF EXISTS trg_break_requests_deny_delete ON public.break_requests;
CREATE TRIGGER trg_break_requests_deny_delete
  BEFORE DELETE ON public.break_requests
  FOR EACH ROW EXECUTE FUNCTION public.break_requests_deny_delete();

-- ---------------------------------------------------------------------------
-- 5) Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.break_terminal_statuses()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'completed', 'rejected', 'ended_by_manager', 'cancelled',
    'cancelled_by_employee', 'cancelled_by_manager'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION public.break_blocking_statuses()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'scheduled', 'pending_approval', 'approved', 'waiting_for_start', 'active'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION public.get_employee_shift_bounds(
  _user_id uuid,
  _at timestamptz
)
RETURNS TABLE(shift_start timestamptz, shift_end timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := (_at AT TIME ZONE 'Asia/Jerusalem')::date;
  v_start time;
  v_end time;
BEGIN
  SELECT
    COALESCE(ss.start_time, sd.start_time),
    COALESCE(ss.end_time, sd.end_time)
  INTO v_start, v_end
  FROM public.schedule_shifts ss
  JOIN public.schedules s ON s.id = ss.schedule_id
  LEFT JOIN public.shift_definitions sd
    ON sd.code = ss.shift AND (sd.branch_id IS NULL OR sd.branch_id = ss.branch_id)
  WHERE ss.employee_id = _user_id
    AND ss.day_date = v_day
    AND s.status = 'approved'
    AND s.published_at IS NOT NULL
  ORDER BY ss.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_start IS NULL OR v_end IS NULL THEN
    RETURN;
  END IF;

  shift_start := (v_day + v_start) AT TIME ZONE 'Asia/Jerusalem';
  shift_end := (v_day + v_end) AT TIME ZONE 'Asia/Jerusalem';
  IF shift_end <= shift_start THEN
    shift_end := shift_end + interval '1 day';
  END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_break_request_times(
  _user_id uuid,
  _planned_start timestamptz,
  _planned_duration integer,
  _exclude_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_end timestamptz;
  v_shift record;
  v_overlap record;
BEGIN
  IF _planned_start IS NULL THEN
    RAISE EXCEPTION 'יש לבחור שעת התחלה להפסקה';
  END IF;
  IF COALESCE(_planned_duration, 0) <= 0 THEN
    RAISE EXCEPTION 'משך ההפסקה חייב להיות גדול מאפס';
  END IF;

  v_end := _planned_start + make_interval(mins => _planned_duration);

  IF EXISTS (
    SELECT 1 FROM public.break_requests br
    WHERE br.user_id = _user_id
      AND (_exclude_id IS NULL OR br.id <> _exclude_id)
      AND br.status::text = ANY(public.break_blocking_statuses())
      AND date_trunc('minute', COALESCE(br.planned_start, br.requested_at))
          = date_trunc('minute', _planned_start)
  ) THEN
    RAISE EXCEPTION 'כבר קיימת הפסקה בשעה זו';
  END IF;

  SELECT br.id INTO v_overlap
  FROM public.break_requests br
  WHERE br.user_id = _user_id
    AND (_exclude_id IS NULL OR br.id <> _exclude_id)
    AND br.status::text = ANY(public.break_blocking_statuses())
    AND tstzrange(
          COALESCE(br.planned_start, br.requested_at),
          COALESCE(br.planned_start, br.requested_at)
            + make_interval(mins => COALESCE(br.planned_duration, br.duration_minutes, 15)),
          '[)'
        )
        && tstzrange(_planned_start, v_end, '[)')
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'ההפסקה חופפת להפסקה קיימת — בחר/י שעה אחרת';
  END IF;

  SELECT * INTO v_shift FROM public.get_employee_shift_bounds(_user_id, _planned_start) LIMIT 1;
  IF FOUND AND v_shift.shift_start IS NOT NULL THEN
    IF _planned_start < v_shift.shift_start THEN
      RAISE EXCEPTION 'לא ניתן לתכנן הפסקה לפני תחילת המשמרת (%s)',
        to_char(v_shift.shift_start AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI');
    END IF;
    IF v_end > v_shift.shift_end THEN
      RAISE EXCEPTION 'לא ניתן לתכנן הפסקה אחרי סיום המשמרת (%s)',
        to_char(v_shift.shift_end AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI');
    END IF;
  END IF;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.write_break_audit(
  _break_request_id uuid,
  _actor_id uuid,
  _target_user_id uuid,
  _action text,
  _payload jsonb DEFAULT '{}'::jsonb,
  _branch_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.break_audit_log (
    break_request_id, actor_id, target_user_id, action, payload, branch_id
  ) VALUES (
    _break_request_id, _actor_id, _target_user_id, _action, _payload, _branch_id
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Policy trigger (INSERT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.break_requests_apply_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.break_policy;
  v_branch uuid;
BEGIN
  NEW.planned_start := COALESCE(NEW.planned_start, NEW.requested_at);
  NEW.planned_duration := COALESCE(NEW.planned_duration, NEW.duration_minutes);
  NEW.duration_minutes := COALESCE(NEW.duration_minutes, NEW.planned_duration);
  NEW.requested_at := NEW.planned_start;

  SELECT COALESCE(pr.branch_id, d.branch_id)
    INTO v_branch
    FROM public.profiles pr
    LEFT JOIN public.departments d ON d.id = COALESCE(NEW.department_id, pr.department_id)
   WHERE pr.id = NEW.user_id;

  NEW.branch_id := v_branch;

  PERFORM public.validate_break_request_times(NEW.user_id, NEW.planned_start, NEW.planned_duration, NULL);

  NEW.started_at := NULL;
  NEW.ends_at := NULL;
  NEW.completed_at := NULL;
  NEW.end_verified_by := NULL;
  NEW.ending_verified_at := NULL;
  NEW.last_modified_at := now();
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

-- ---------------------------------------------------------------------------
-- 7) AFTER INSERT — notifications, promote scheduled, audit
-- ---------------------------------------------------------------------------
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
  SELECT COALESCE(p.full_name, 'עובד') INTO v_employee FROM public.profiles p WHERE p.id = _req.user_id;
  SELECT COALESCE(bs.name, 'הפסקה') INTO v_break_type FROM public.break_settings bs WHERE bs.id = _req.break_setting_id;
  v_start := to_char(COALESCE(_req.planned_start, _req.requested_at) AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI');
  v_msg := format('בקשת הפסקה חדשה: %s · %s · התחלה %s · %s דק׳',
    v_employee, v_break_type, v_start, COALESCE(_req.planned_duration, _req.duration_minutes));

  FOR v_uid IN
    SELECT DISTINCT u.id FROM auth.users u
    JOIN public.profiles pr ON pr.id = u.id
    WHERE pr.is_active IS DISTINCT FROM false
      AND public.can_approve_break_by_policy(u.id)
      AND u.id <> _req.user_id
  LOOP
    BEGIN
      INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
      VALUES (v_uid, NULL, v_msg, _req.branch_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END;
$$;

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
    UPDATE public.break_requests SET status = 'waiting_for_start'::public.break_request_status
     WHERE id = NEW.id
       AND status = 'scheduled'::public.break_request_status
       AND COALESCE(planned_start, requested_at) > now();
  ELSIF NEW.status = 'pending_approval'::public.break_request_status THEN
    PERFORM public.notify_break_approvers(NEW);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_break_requests_after_insert ON public.break_requests;
CREATE TRIGGER trg_break_requests_after_insert
  AFTER INSERT ON public.break_requests
  FOR EACH ROW EXECUTE FUNCTION public.break_requests_after_insert();

-- ---------------------------------------------------------------------------
-- 8) AFTER approve → waiting_for_start + notification
-- ---------------------------------------------------------------------------
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

DROP TRIGGER IF EXISTS trg_break_requests_after_approve ON public.break_requests;
CREATE TRIGGER trg_break_requests_after_approve
  AFTER UPDATE OF status ON public.break_requests
  FOR EACH ROW EXECUTE FUNCTION public.break_requests_after_approve();

-- ---------------------------------------------------------------------------
-- 9) Activate due breaks (only one active per user)
-- ---------------------------------------------------------------------------
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
    ORDER BY COALESCE(planned_start, approved_at_time, requested_at)
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.break_requests
      WHERE user_id = r.user_id AND status = 'active'::public.break_request_status
    ) THEN
      CONTINUE;
    END IF;

    v_start := now();
    v_dur := COALESCE(r.planned_duration, r.duration_minutes,
      (SELECT duration_minutes FROM public.break_settings WHERE id = r.break_setting_id));

    UPDATE public.break_requests
       SET status = 'active'::public.break_request_status,
           started_at = v_start,
           actual_start = v_start,
           ends_at = v_start + make_interval(mins => COALESCE(v_dur, 15)),
           start_notified_at = COALESCE(start_notified_at, now()),
           last_modified_at = now()
     WHERE id = r.id;

    PERFORM public.write_break_audit(
      r.id, r.user_id, r.user_id, 'started',
      jsonb_build_object('started_at', v_start, 'ends_at', v_start + make_interval(mins => COALESCE(v_dur, 15))),
      r.branch_id
    );

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
  FOR EACH ROW EXECUTE FUNCTION public.break_requests_activate_if_due();

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

DROP TRIGGER IF EXISTS trg_guard_manual_break_completion ON public.break_requests;
CREATE TRIGGER trg_guard_manual_break_completion
  BEFORE UPDATE ON public.break_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_manual_break_completion();

-- ---------------------------------------------------------------------------
-- 10) RPCs
-- ---------------------------------------------------------------------------
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
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.can_approve_break_by_policy(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לאשר הפסקות';
  END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;
  IF r.status <> 'pending_approval'::public.break_request_status THEN
    RAISE EXCEPTION 'ניתן לאשר רק בקשות הממתינות לאישור';
  END IF;

  v_time := COALESCE(_approved_at_time, r.planned_start, r.requested_at);
  PERFORM public.validate_break_request_times(r.user_id, v_time, COALESCE(r.planned_duration, r.duration_minutes), _id);

  UPDATE public.break_requests
     SET status = 'approved'::public.break_request_status,
         approved_at_time = v_time,
         planned_start = v_time,
         requested_at = v_time,
         approved_by = v_actor,
         approval_decided_at = now(),
         last_modified_at = now()
   WHERE id = _id;

  PERFORM public.write_break_audit(_id, v_actor, r.user_id, 'approve',
    jsonb_build_object('approved_at_time', v_time), r.branch_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_break_request(_id uuid, _reason text DEFAULT NULL)
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
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.can_approve_break_by_policy(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לדחות הפסקות';
  END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;
  IF r.status <> 'pending_approval'::public.break_request_status THEN
    RAISE EXCEPTION 'ניתן לדחות רק בקשות הממתינות לאישור';
  END IF;

  UPDATE public.break_requests
     SET status = 'rejected'::public.break_request_status,
         rejection_reason = NULLIF(btrim(_reason), ''),
         rejected_at = now(),
         rejected_by = v_actor,
         last_modified_at = now()
   WHERE id = _id;

  v_msg := 'בקשת ההפסקה נדחתה';
  IF NULLIF(btrim(_reason), '') IS NOT NULL THEN v_msg := v_msg || ': ' || btrim(_reason); END IF;
  BEGIN
    INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
    VALUES (r.user_id, NULL, v_msg, r.branch_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM public.write_break_audit(_id, v_actor, r.user_id, 'reject',
    jsonb_build_object('reason', NULLIF(btrim(_reason), '')), r.branch_id);
END;
$$;

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

  v_dur := COALESCE(_new_duration, r.planned_duration, r.duration_minutes);
  PERFORM public.validate_break_request_times(r.user_id, _new_start, v_dur, _id);

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

  PERFORM public.write_break_audit(_id, v_actor, r.user_id, 'reschedule',
    jsonb_build_object('new_start', _new_start, 'new_duration', v_dur), r.branch_id);

  IF v_is_manager AND r.status = 'pending_approval'::public.break_request_status THEN
    PERFORM public.approve_break_request(_id, _new_start);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_break_request(_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_is_manager boolean;
  v_new_status public.break_request_status;
  v_action text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;

  v_is_manager := public.can_manually_end_break(v_actor) OR public.can_approve_break_by_policy(v_actor);

  IF v_is_manager THEN
    IF r.status = 'active'::public.break_request_status THEN
      RAISE EXCEPTION 'לא ניתן לבטל הפסקה פעילה — יש לסיים אותה';
    END IF;
    v_new_status := 'cancelled_by_manager'::public.break_request_status;
    v_action := 'cancel_manager';
  ELSE
    IF r.user_id <> v_actor THEN RAISE EXCEPTION 'אין הרשאה'; END IF;
    IF r.status NOT IN (
      'pending_approval'::public.break_request_status,
      'scheduled'::public.break_request_status,
      'waiting_for_start'::public.break_request_status,
      'approved'::public.break_request_status
    ) THEN
      RAISE EXCEPTION 'לא ניתן לבטל הפסקה במצב זה';
    END IF;
    v_new_status := 'cancelled_by_employee'::public.break_request_status;
    v_action := 'cancel_employee';
  END IF;

  UPDATE public.break_requests
     SET status = v_new_status,
         cancelled_by = v_actor,
         cancelled_at = now(),
         cancellation_reason = NULLIF(btrim(_reason), ''),
         last_modified_at = now()
   WHERE id = _id;

  PERFORM public.write_break_audit(_id, v_actor, r.user_id, v_action,
    jsonb_build_object('reason', NULLIF(btrim(_reason), '')), r.branch_id);
END;
$$;

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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;
  IF r.user_id <> auth.uid() THEN RAISE EXCEPTION 'אין הרשאה'; END IF;
  IF r.status <> 'active'::public.break_request_status THEN
    RAISE EXCEPTION 'אין הפסקה פעילה לסיום';
  END IF;

  SELECT * INTO v_fields FROM public.compute_break_end_fields(
    r.planned_start, r.planned_duration, r.ends_at,
    COALESCE(r.actual_start, r.started_at, now()), v_end
  );

  UPDATE public.break_requests
     SET status = 'completed'::public.break_request_status,
         started_at = COALESCE(started_at, actual_start, now()),
         actual_start = COALESCE(actual_start, started_at, now()),
         actual_end = v_end,
         completed_at = v_end,
         end_verified_by = auth.uid(),
         ending_verified_at = v_end,
         last_modified_at = v_end,
         actual_duration = v_fields.actual_duration,
         overtime_minutes = v_fields.overtime_minutes,
         ended_by = 'employee',
         end_notified_at = COALESCE(end_notified_at, v_end)
   WHERE id = _id;

  PERFORM public.write_break_audit(_id, auth.uid(), r.user_id, 'completed',
    jsonb_build_object(
      'actual_duration', v_fields.actual_duration,
      'overtime_minutes', v_fields.overtime_minutes
    ), r.branch_id);
END;
$$;

DROP FUNCTION IF EXISTS public.manual_end_break(uuid);

CREATE OR REPLACE FUNCTION public.manual_end_break(_id uuid, _reason text DEFAULT NULL)
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
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.can_manually_end_break(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לסיים הפסקה של עובד';
  END IF;

  SELECT * INTO r FROM public.break_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'הפסקה לא נמצאה'; END IF;
  IF r.status <> 'active'::public.break_request_status THEN
    RAISE EXCEPTION 'ניתן לסיים ידנית רק הפסקה פעילה';
  END IF;

  SELECT COALESCE(p.full_name, 'מנהל') INTO v_manager_name FROM public.profiles p WHERE p.id = v_actor;
  v_started := COALESCE(r.actual_start, r.started_at, r.planned_start, v_end);

  SELECT * INTO v_fields FROM public.compute_break_end_fields(
    r.planned_start, r.planned_duration, r.ends_at, v_started, v_end
  );

  UPDATE public.break_requests
     SET status = 'ended_by_manager'::public.break_request_status,
         started_at = v_started,
         actual_start = v_started,
         actual_end = v_end,
         completed_at = v_end,
         end_verified_by = v_actor,
         ending_verified_at = v_end,
         last_modified_at = v_end,
         actual_duration = v_fields.actual_duration,
         overtime_minutes = v_fields.overtime_minutes,
         ended_by = 'manager',
         ended_by_manager_id = v_actor,
         ended_by_manager_name = v_manager_name,
         end_notified_at = COALESCE(end_notified_at, v_end)
   WHERE id = _id;

  PERFORM public.write_break_audit(_id, v_actor, r.user_id, 'manual_end',
    jsonb_build_object(
      'message', 'ההפסקה הסתיימה על ידי מנהל',
      'reason', NULLIF(btrim(_reason), ''),
      'manager_name', v_manager_name,
      'actual_duration_minutes', v_fields.actual_duration,
      'overtime_minutes', v_fields.overtime_minutes
    ), r.branch_id);

  BEGIN
    INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
    VALUES (r.user_id, NULL, 'ההפסקה הסתיימה על ידי מנהל', r.branch_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_break_by_manager(_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT public.manual_end_break(_id, _reason); $$;

-- ---------------------------------------------------------------------------
-- 11) RLS — cancel policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users cancel their own pending break" ON public.break_requests;
DROP POLICY IF EXISTS "Users cancel own future breaks" ON public.break_requests;

CREATE POLICY "Users cancel own future breaks"
  ON public.break_requests FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND status IN (
      'pending_approval'::public.break_request_status,
      'scheduled'::public.break_request_status,
      'waiting_for_start'::public.break_request_status,
      'approved'::public.break_request_status
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND status IN (
      'cancelled'::public.break_request_status,
      'cancelled_by_employee'::public.break_request_status
    )
  );

-- ---------------------------------------------------------------------------
-- 12) Grants
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.activate_due_break_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_due_break_requests() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.approve_break_request(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_break_request(uuid, timestamptz) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.reject_break_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_break_request(uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.reschedule_break_request(uuid, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_break_request(uuid, timestamptz, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.cancel_break_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_break_request(uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.end_my_break(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_my_break(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.manual_end_break(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_end_break(uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.end_break_by_manager(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_break_by_manager(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.process_break_lifecycle()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN PERFORM public.activate_due_break_requests(); END; $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'activate-due-break-requests') THEN
    PERFORM cron.unschedule('activate-due-break-requests');
  END IF;
  PERFORM cron.schedule(
    'activate-due-break-requests', '* * * * *',
    $CRON$ SELECT public.activate_due_break_requests(); $CRON$
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Sanity: no completed_by references
DO $$
DECLARE bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND (p.proname LIKE '%break%' OR pg_get_functiondef(p.oid) ILIKE '%break_requests%')
    AND pg_get_functiondef(p.oid) ILIKE '%completed_by%';
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Break functions still reference completed_by (% found)', bad_count;
  END IF;
END $$;
