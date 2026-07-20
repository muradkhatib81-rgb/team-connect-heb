-- Equipment management (מערכת ניהול ציוד) — branch-scoped interactive dashboard board.
-- Additive only: new tables, new permission columns, new RPCs. Does not alter existing permissions logic.

-- ---------------------------------------------------------------------------
-- 1) Permission columns (additive — default false, existing rows unchanged)
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS can_create_custody boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit_custody boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_delete_custody boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_return_custody boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_receive_custody_alerts boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_custody_daily_log boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_run_custody_monthly_report boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_configure_custody boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2) Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.custody_branch_settings (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  default_employee_reminder_minutes integer NOT NULL DEFAULT 60
    CHECK (default_employee_reminder_minutes > 0),
  manager_midnight_warning_minutes integer NOT NULL DEFAULT 60
    CHECK (manager_midnight_warning_minutes > 0),
  daily_log_reset_hours integer NOT NULL DEFAULT 24
    CHECK (daily_log_reset_hours > 0),
  timezone text NOT NULL DEFAULT 'Asia/Jerusalem',
  last_daily_reset_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.custody_item_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  employee_reminder_minutes integer NULL
    CHECK (employee_reminder_minutes IS NULL OR employee_reminder_minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, name)
);

CREATE INDEX IF NOT EXISTS idx_custody_item_types_branch
  ON public.custody_item_types(branch_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.custody_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  item_type_id uuid NOT NULL REFERENCES public.custody_item_types(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  department_id uuid NULL REFERENCES public.departments(id) ON DELETE SET NULL,
  checked_out_at timestamptz NOT NULL DEFAULT now(),
  checked_out_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  returned_at timestamptz NULL,
  returned_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  return_type text NULL CHECK (return_type IS NULL OR return_type IN ('self', 'manager')),
  duration_minutes integer NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned')),
  spans_midnight boolean NOT NULL DEFAULT false,
  employee_reminder_sent_at timestamptz NULL,
  manager_midnight_warn_sent_at timestamptz NULL,
  shift_end_alert_sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_custody_checkouts_one_active_per_item
  ON public.custody_checkouts(item_type_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_custody_checkouts_branch_active
  ON public.custody_checkouts(branch_id, status);

CREATE INDEX IF NOT EXISTS idx_custody_checkouts_user_active
  ON public.custody_checkouts(user_id, status);

CREATE TABLE IF NOT EXISTS public.custody_daily_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  stat_date date NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_type_id uuid NOT NULL REFERENCES public.custody_item_types(id) ON DELETE CASCADE,
  checkout_count integer NOT NULL DEFAULT 0,
  total_minutes integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, stat_date, user_id, item_type_id)
);

CREATE TABLE IF NOT EXISTS public.custody_session_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  checkout_id uuid NOT NULL,
  item_type_id uuid NOT NULL REFERENCES public.custody_item_types(id) ON DELETE RESTRICT,
  item_name text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  department_id uuid NULL,
  department_name text NULL,
  checked_out_at timestamptz NOT NULL,
  returned_at timestamptz NOT NULL,
  returned_by uuid NULL,
  return_type text NOT NULL CHECK (return_type IN ('self', 'manager')),
  return_actor_name text NULL,
  duration_minutes integer NOT NULL DEFAULT 0,
  spans_midnight boolean NOT NULL DEFAULT false,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custody_session_archive_branch
  ON public.custody_session_archive(branch_id, returned_at DESC);

CREATE TABLE IF NOT EXISTS public.custody_monthly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  report_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  purged_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS public.custody_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  checkout_id uuid NULL,
  actor_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custody_audit_log_branch
  ON public.custody_audit_log(branch_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custody_branch_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custody_item_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custody_checkouts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custody_daily_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custody_session_archive TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custody_monthly_reports TO authenticated;
GRANT SELECT, INSERT ON public.custody_audit_log TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

ALTER TABLE public.custody_branch_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custody_item_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custody_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custody_daily_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custody_session_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custody_monthly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custody_audit_log ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3) Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_custody_create_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_owner(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_task_permissions p
      WHERE p.user_id = _user_id AND p.can_create_custody = true
    );
$$;

CREATE OR REPLACE FUNCTION public.has_custody_edit_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_owner(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_task_permissions p
      WHERE p.user_id = _user_id AND p.can_edit_custody = true
    );
$$;

CREATE OR REPLACE FUNCTION public.has_custody_delete_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_owner(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_task_permissions p
      WHERE p.user_id = _user_id AND p.can_delete_custody = true
    );
$$;

CREATE OR REPLACE FUNCTION public.has_custody_configure_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_owner(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_task_permissions p
      WHERE p.user_id = _user_id AND p.can_configure_custody = true
    );
$$;

CREATE OR REPLACE FUNCTION public.has_custody_return_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_owner(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_task_permissions p
      WHERE p.user_id = _user_id AND p.can_return_custody = true
    );
$$;

CREATE OR REPLACE FUNCTION public.has_custody_alert_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_owner(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_task_permissions p
      WHERE p.user_id = _user_id AND p.can_receive_custody_alerts = true
    );
$$;

CREATE OR REPLACE FUNCTION public.is_user_on_work_shift(
  _user_id uuid,
  _at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift record;
BEGIN
  SELECT * INTO v_shift
  FROM public.get_employee_shift_bounds(_user_id, _at)
  LIMIT 1;

  IF NOT FOUND OR v_shift.shift_start IS NULL THEN
    RETURN false;
  END IF;

  RETURN _at >= v_shift.shift_start AND _at < v_shift.shift_end;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_management_on_shift(
  _user_id uuid,
  _branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.management_on_shift m
    WHERE m.user_id = _user_id AND m.branch_id = _branch_id
  );
$$;

CREATE OR REPLACE FUNCTION public.custody_effective_branch(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.current_active_branch(),
    (SELECT branch_id FROM public.profiles WHERE id = _user_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_custody_board_visible(
  _user_id uuid DEFAULT auth.uid(),
  _at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  v_branch := public.custody_effective_branch(_user_id);
  IF v_branch IS NULL THEN
    RETURN false;
  END IF;

  -- Platform owner: always visible when active branch is selected.
  IF public.is_platform_owner(_user_id) THEN
    RETURN public.current_active_branch() IS NOT NULL;
  END IF;

  -- Branch / assistant manager: visible only when marked on shift.
  IF public.has_role(_user_id, 'branch_manager'::public.app_role)
     OR public.has_role(_user_id, 'assistant_manager'::public.app_role) THEN
    RETURN public.is_management_on_shift(_user_id, v_branch);
  END IF;

  -- Employee & department manager: published schedule window.
  RETURN public.is_user_on_work_shift(_user_id, _at);
END;
$$;

CREATE OR REPLACE FUNCTION public.write_custody_audit(
  _branch_id uuid,
  _checkout_id uuid,
  _actor_id uuid,
  _target_user_id uuid,
  _action text,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.custody_audit_log (
    branch_id, checkout_id, actor_id, target_user_id, action, payload
  ) VALUES (
    _branch_id, _checkout_id, _actor_id, _target_user_id, _action, _payload
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.checkout_custody_item(_item_type_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_item public.custody_item_types%ROWTYPE;
  v_branch uuid;
  v_dept uuid;
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO v_item FROM public.custody_item_types
  WHERE id = _item_type_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'פריט ציוד לא נמצא'; END IF;

  v_branch := public.custody_effective_branch(v_actor);
  IF v_branch IS NULL OR v_item.branch_id <> v_branch THEN
    RAISE EXCEPTION 'אין הרשאה לסניף זה';
  END IF;

  IF NOT public.is_custody_board_visible(v_actor) THEN
    RAISE EXCEPTION 'לוח הציוד זמין רק במהלך משמרת';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.custody_checkouts c
    WHERE c.item_type_id = _item_type_id AND c.status = 'active'
  ) THEN
    RAISE EXCEPTION 'הציוד כבר בשימוש';
  END IF;

  SELECT department_id INTO v_dept FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.custody_checkouts (
    branch_id, item_type_id, user_id, department_id,
    checked_out_by, status
  ) VALUES (
    v_branch, _item_type_id, v_actor, v_dept,
    v_actor, 'active'
  )
  RETURNING id INTO v_id;

  PERFORM public.write_custody_audit(
    v_branch, v_id, v_actor, v_actor, 'checkout',
    jsonb_build_object('item_type_id', _item_type_id, 'item_name', v_item.name)
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_custody_item(_checkout_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  r public.custody_checkouts%ROWTYPE;
  v_item public.custody_item_types%ROWTYPE;
  v_is_manager boolean;
  v_return_type text;
  v_actor_name text;
  v_dur integer;
  v_spans boolean;
  v_day date;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO r FROM public.custody_checkouts WHERE id = _checkout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'רשומה לא נמצאה'; END IF;
  IF r.status <> 'active' THEN RAISE EXCEPTION 'הציוד כבר הוחזר'; END IF;

  IF r.branch_id <> public.custody_effective_branch(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לסניף זה';
  END IF;

  v_is_manager := public.has_custody_return_perm(v_actor);

  IF r.user_id <> v_actor AND NOT v_is_manager THEN
    RAISE EXCEPTION 'אין הרשאה להחזיר ציוד זה';
  END IF;

  v_return_type := CASE WHEN r.user_id = v_actor THEN 'self' ELSE 'manager' END;

  v_dur := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (now() - r.checked_out_at)) / 60.0)::integer);
  v_spans := (r.checked_out_at AT TIME ZONE 'Asia/Jerusalem')::date
          <> (now() AT TIME ZONE 'Asia/Jerusalem')::date;

  UPDATE public.custody_checkouts
     SET status = 'returned',
         returned_at = now(),
         returned_by = v_actor,
         return_type = v_return_type,
         duration_minutes = v_dur,
         spans_midnight = v_spans,
         updated_at = now()
   WHERE id = _checkout_id;

  SELECT * INTO v_item FROM public.custody_item_types WHERE id = r.item_type_id;

  SELECT COALESCE(full_name, '—') INTO v_actor_name FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.custody_session_archive (
    branch_id, checkout_id, item_type_id, item_name,
    user_id, user_name, department_id, department_name,
    checked_out_at, returned_at, returned_by, return_type,
    return_actor_name, duration_minutes, spans_midnight
  )
  SELECT
    r.branch_id, r.id, r.item_type_id, v_item.name,
    r.user_id, COALESCE(p.full_name, '—'), r.department_id, d.name,
    r.checked_out_at, now(), v_actor, v_return_type,
    CASE WHEN v_return_type = 'manager' THEN v_actor_name ELSE NULL END,
    v_dur, v_spans
  FROM public.profiles p
  LEFT JOIN public.departments d ON d.id = r.department_id
  WHERE p.id = r.user_id;

  v_day := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  INSERT INTO public.custody_daily_entries (
    branch_id, stat_date, user_id, item_type_id, checkout_count, total_minutes
  ) VALUES (
    r.branch_id, v_day, r.user_id, r.item_type_id, 1, v_dur
  )
  ON CONFLICT (branch_id, stat_date, user_id, item_type_id)
  DO UPDATE SET
    checkout_count = custody_daily_entries.checkout_count + 1,
    total_minutes = custody_daily_entries.total_minutes + EXCLUDED.total_minutes,
    updated_at = now();

  PERFORM public.write_custody_audit(
    r.branch_id, _checkout_id, v_actor, r.user_id, 'return',
    jsonb_build_object(
      'return_type', v_return_type,
      'duration_minutes', v_dur,
      'manager_name', CASE WHEN v_return_type = 'manager' THEN v_actor_name ELSE NULL END
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_custody_item_type(
  _name text,
  _id uuid DEFAULT NULL,
  _sort_order integer DEFAULT 0,
  _is_active boolean DEFAULT true,
  _employee_reminder_minutes integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch uuid;
  v_out uuid;
  v_existing public.custody_item_types%ROWTYPE;
  v_deactivating boolean;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  v_branch := public.custody_effective_branch(v_actor);
  IF v_branch IS NULL THEN RAISE EXCEPTION 'לא נמצא סניף'; END IF;
  IF NULLIF(btrim(_name), '') IS NULL THEN RAISE EXCEPTION 'יש להזין שם'; END IF;

  IF _id IS NULL THEN
    IF NOT public.has_custody_create_perm(v_actor) THEN
      RAISE EXCEPTION 'אין הרשאה ליצור ציוד';
    END IF;
    INSERT INTO public.custody_item_types (
      branch_id, name, sort_order, is_active, employee_reminder_minutes
    ) VALUES (
      v_branch, btrim(_name), COALESCE(_sort_order, 0), COALESCE(_is_active, true), _employee_reminder_minutes
    )
    RETURNING id INTO v_out;
  ELSE
    SELECT * INTO v_existing FROM public.custody_item_types
    WHERE id = _id AND branch_id = v_branch;
    IF NOT FOUND THEN RAISE EXCEPTION 'פריט ציוד לא נמצא'; END IF;

    v_deactivating := v_existing.is_active = true AND COALESCE(_is_active, true) = false;
    IF v_deactivating THEN
      IF NOT public.has_custody_delete_perm(v_actor) THEN
        RAISE EXCEPTION 'אין הרשאה למחוק/להשבית ציוד';
      END IF;
    ELSE
      IF NOT public.has_custody_edit_perm(v_actor) THEN
        RAISE EXCEPTION 'אין הרשאה לערוך ציוד';
      END IF;
    END IF;

    UPDATE public.custody_item_types
       SET name = btrim(_name),
           sort_order = COALESCE(_sort_order, sort_order),
           is_active = COALESCE(_is_active, is_active),
           employee_reminder_minutes = _employee_reminder_minutes,
           updated_at = now()
     WHERE id = _id AND branch_id = v_branch
     RETURNING id INTO v_out;
  END IF;

  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_custody_branch_settings(
  _default_employee_reminder_minutes integer DEFAULT NULL,
  _manager_midnight_warning_minutes integer DEFAULT NULL,
  _daily_log_reset_hours integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.has_custody_configure_perm(v_actor) THEN
    RAISE EXCEPTION 'אין הרשאה לעדכן הגדרות';
  END IF;

  v_branch := public.custody_effective_branch(v_actor);
  IF v_branch IS NULL THEN RAISE EXCEPTION 'לא נמצא סניף'; END IF;

  INSERT INTO public.custody_branch_settings (branch_id)
  VALUES (v_branch)
  ON CONFLICT (branch_id) DO NOTHING;

  UPDATE public.custody_branch_settings
     SET default_employee_reminder_minutes = COALESCE(_default_employee_reminder_minutes, default_employee_reminder_minutes),
         manager_midnight_warning_minutes = COALESCE(_manager_midnight_warning_minutes, manager_midnight_warning_minutes),
         daily_log_reset_hours = COALESCE(_daily_log_reset_hours, daily_log_reset_hours),
         updated_at = now()
   WHERE branch_id = v_branch;
END;
$$;

-- Reminder processor (cron-ready; idempotent flags on checkout rows).
CREATE OR REPLACE FUNCTION public.process_custody_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_settings public.custody_branch_settings%ROWTYPE;
  v_reminder_mins integer;
  v_midnight_warn_mins integer;
  v_local timestamp;
  v_user_name text;
  v_item_name text;
  v_msg text;
BEGIN
  FOR r IN
    SELECT c.*, it.name AS item_name, it.employee_reminder_minutes AS item_reminder
    FROM public.custody_checkouts c
    JOIN public.custody_item_types it ON it.id = c.item_type_id
    WHERE c.status = 'active'
  LOOP
    SELECT * INTO v_settings FROM public.custody_branch_settings WHERE branch_id = r.branch_id;
    v_reminder_mins := COALESCE(r.item_reminder, v_settings.default_employee_reminder_minutes, 60);
    v_midnight_warn_mins := COALESCE(v_settings.manager_midnight_warning_minutes, 60);

    -- Employee reminder after X minutes.
    IF r.employee_reminder_sent_at IS NULL
       AND r.checked_out_at + make_interval(mins => v_reminder_mins) <= now() THEN
      SELECT COALESCE(full_name, 'עובד') INTO v_user_name FROM public.profiles WHERE id = r.user_id;
      v_msg := format('יש להחזיר את "%s"', r.item_name);
      BEGIN
        INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
        VALUES (r.user_id, NULL, v_msg, r.branch_id);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      UPDATE public.custody_checkouts SET employee_reminder_sent_at = now() WHERE id = r.id;
    END IF;

    -- Shift ended but still active.
    IF r.shift_end_alert_sent_at IS NULL
       AND NOT public.is_user_on_work_shift(r.user_id, now()) THEN
      SELECT COALESCE(full_name, 'עובד') INTO v_user_name FROM public.profiles WHERE id = r.user_id;
      v_msg := format('העובד %s סיים משמרת ועדיין מחזיק: %s', v_user_name, r.item_name);
      INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
      SELECT p.id, NULL, v_msg, r.branch_id
      FROM public.profiles p
      WHERE p.branch_id = r.branch_id
        AND public.has_custody_alert_perm(p.id);
      UPDATE public.custody_checkouts SET shift_end_alert_sent_at = now() WHERE id = r.id;
    END IF;

    -- Manager warning before midnight (Jerusalem).
    v_local := (now() AT TIME ZONE COALESCE(v_settings.timezone, 'Asia/Jerusalem'));
    IF r.manager_midnight_warn_sent_at IS NULL THEN
      IF EXTRACT(EPOCH FROM (
           (date_trunc('day', v_local) + interval '1 day') - v_local
         )) / 60.0 <= v_midnight_warn_mins THEN
        v_msg := format('"%s" לא הוחזר — נדרשת החזרה לפני חצות', r.item_name);
        INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
        SELECT p.id, NULL, v_msg, r.branch_id
        FROM public.profiles p
        WHERE p.branch_id = r.branch_id
          AND public.has_custody_alert_perm(p.id);
        UPDATE public.custody_checkouts SET manager_midnight_warn_sent_at = now() WHERE id = r.id;
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_custody_daily_log()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
BEGIN
  FOR s IN SELECT * FROM public.custody_branch_settings LOOP
    IF s.last_daily_reset_at IS NULL
       OR s.last_daily_reset_at + make_interval(hours => s.daily_log_reset_hours) <= now() THEN
      DELETE FROM public.custody_daily_entries
      WHERE branch_id = s.branch_id
        AND stat_date < (now() AT TIME ZONE s.timezone)::date;
      UPDATE public.custody_branch_settings
         SET last_daily_reset_at = now(), updated_at = now()
       WHERE branch_id = s.branch_id;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------
CREATE POLICY custody_branch_settings_select ON public.custody_branch_settings
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.custody_effective_branch(auth.uid())
  );

CREATE POLICY custody_branch_settings_manage ON public.custody_branch_settings
  FOR ALL TO authenticated
  USING (public.has_custody_configure_perm(auth.uid()))
  WITH CHECK (public.has_custody_configure_perm(auth.uid()));

CREATE POLICY custody_item_types_select ON public.custody_item_types
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.custody_effective_branch(auth.uid())
  );

CREATE POLICY custody_item_types_manage ON public.custody_item_types
  FOR ALL TO authenticated
  USING (
    public.has_custody_create_perm(auth.uid())
    OR public.has_custody_edit_perm(auth.uid())
    OR public.has_custody_delete_perm(auth.uid())
  )
  WITH CHECK (
    public.has_custody_create_perm(auth.uid())
    OR public.has_custody_edit_perm(auth.uid())
    OR public.has_custody_delete_perm(auth.uid())
  );

CREATE POLICY custody_checkouts_select ON public.custody_checkouts
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.custody_effective_branch(auth.uid())
  );

CREATE POLICY custody_checkouts_insert ON public.custody_checkouts
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY custody_checkouts_update ON public.custody_checkouts
  FOR UPDATE TO authenticated
  WITH CHECK (false);

CREATE POLICY custody_daily_select ON public.custody_daily_entries
  FOR SELECT TO authenticated
  USING (
    branch_id = public.custody_effective_branch(auth.uid())
    AND (
      public.is_platform_owner(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid() AND p.can_view_custody_daily_log = true
      )
    )
  );

CREATE POLICY custody_archive_select ON public.custody_session_archive
  FOR SELECT TO authenticated
  USING (
    branch_id = public.custody_effective_branch(auth.uid())
    AND (
      public.is_platform_owner(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid() AND p.can_run_custody_monthly_report = true
      )
    )
  );

CREATE POLICY custody_reports_select ON public.custody_monthly_reports
  FOR SELECT TO authenticated
  USING (
    branch_id = public.custody_effective_branch(auth.uid())
    AND (
      public.is_platform_owner(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid() AND p.can_run_custody_monthly_report = true
      )
    )
  );

CREATE POLICY custody_audit_select ON public.custody_audit_log
  FOR SELECT TO authenticated
  USING (
    branch_id = public.custody_effective_branch(auth.uid())
    AND (
      public.is_platform_owner(auth.uid())
      OR public.has_custody_create_perm(auth.uid())
      OR public.has_custody_edit_perm(auth.uid())
      OR public.has_custody_delete_perm(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid() AND p.can_view_custody_daily_log = true
      )
    )
  );

-- Restrictive branch scope (same pattern as management_on_shift).
CREATE POLICY custody_branch_scope_item_types ON public.custody_item_types
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.custody_effective_branch(auth.uid())
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.custody_effective_branch(auth.uid())
  );

CREATE POLICY custody_branch_scope_checkouts ON public.custody_checkouts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.custody_effective_branch(auth.uid())
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.custody_effective_branch(auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 6) Realtime + grants
-- ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.custody_item_types;
ALTER PUBLICATION supabase_realtime ADD TABLE public.custody_checkouts;

REVOKE EXECUTE ON FUNCTION public.checkout_custody_item(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.return_custody_item(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_custody_board_visible(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_custody_item_type(text, uuid, integer, boolean, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_custody_branch_settings(integer, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.checkout_custody_item(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.return_custody_item(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_custody_board_visible(uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_custody_item_type(text, uuid, integer, boolean, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_custody_branch_settings(integer, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_custody_reminders() TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_custody_daily_log() TO service_role;
