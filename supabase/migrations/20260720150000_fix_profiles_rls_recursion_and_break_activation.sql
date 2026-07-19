-- Fix infinite recursion in profiles RLS (policies calling functions that re-query profiles).
-- Harden scheduled break activation (reliable per-user earliest-due activation + cron).

-- ---------------------------------------------------------------------------
-- 1) Internal profile scope lookup — bypasses RLS (used only inside policy helpers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profile_scope_internal(_profile_id uuid)
RETURNS TABLE(department_id uuid, branch_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT p.department_id, p.branch_id
  FROM public.profiles p
  WHERE p.id = _profile_id;
$$;

REVOKE EXECUTE ON FUNCTION public.profile_scope_internal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_scope_internal(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Rewrite scope helpers to avoid self-referential profiles reads under RLS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_schedule_department(
  _user_id uuid,
  _department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(_user_id)
    OR public.has_role(_user_id, 'branch_manager'::public.app_role)
    OR (
      public.has_role(_user_id, 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.user_task_permissions permission
        WHERE permission.user_id = _user_id
          AND permission.can_manage_departments = true
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.profile_scope_internal(_user_id) profile
      WHERE profile.department_id = _department_id
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_department_directory(
  _user_id uuid,
  _department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(_user_id)
    OR public.has_role(_user_id, 'branch_manager'::public.app_role)
    OR (
      public.has_role(_user_id, 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.user_task_permissions permission
        WHERE permission.user_id = _user_id
          AND permission.can_manage_departments = true
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.profile_scope_internal(_user_id) profile
      WHERE profile.department_id = _department_id
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_profile(
  _user_id uuid,
  _profile_id uuid,
  _department_id uuid,
  _branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _profile_id = _user_id
    OR public.is_platform_owner(_user_id)
    OR public.has_role(_user_id, 'branch_manager'::public.app_role)
    OR (
      public.has_role(_user_id, 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.user_task_permissions permission
        WHERE permission.user_id = _user_id
          AND (
            permission.can_view_all_employees
            OR permission.can_view_employee_details
            OR permission.can_add_employee
            OR permission.can_edit_employee
            OR permission.can_delete_employee
            OR permission.can_manage_employee_of_month
          )
      )
    )
    OR (
      public.has_role(_user_id, 'department_manager'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.profile_scope_internal(_user_id) caller
        WHERE caller.department_id = _department_id
          AND caller.branch_id = _branch_id
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.current_active_branch()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_header text;
  v_uuid uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_header := nullif(
      current_setting('request.headers', true)::json->>'x-active-branch',
      ''
    );
  EXCEPTION WHEN others THEN
    v_header := NULL;
  END;

  IF public.is_platform_owner(v_uid) THEN
    IF v_header IS NULL THEN
      RETURN NULL;
    END IF;
    BEGIN
      v_uuid := v_header::uuid;
    EXCEPTION WHEN others THEN
      v_uuid := NULL;
    END;
    RETURN v_uuid;
  END IF;

  SELECT s.branch_id INTO v_uuid
  FROM public.profile_scope_internal(v_uid) s;
  RETURN v_uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_active_branch() TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 3) Break activation — earliest due break per user, no DISTINCT ON + FOR UPDATE quirks
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
  v_seen uuid[] := '{}';
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
    ORDER BY user_id, COALESCE(planned_start, approved_at_time, requested_at) ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    IF r.user_id = ANY (v_seen) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.break_requests active_row
      WHERE active_row.user_id = r.user_id
        AND active_row.status = 'active'::public.break_request_status
    ) THEN
      v_seen := array_append(v_seen, r.user_id);
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

    v_seen := array_append(v_seen, r.user_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_due_breaks_for_user(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.break_requests%ROWTYPE;
  v_start timestamptz;
  v_dur int;
BEGIN
  IF _user_id IS NULL THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.break_requests
    WHERE user_id = _user_id
      AND status = 'active'::public.break_request_status
  ) THEN
    RETURN 0;
  END IF;

  SELECT *
    INTO r
    FROM public.break_requests
   WHERE user_id = _user_id
     AND status IN (
       'scheduled'::public.break_request_status,
       'approved'::public.break_request_status,
       'waiting_for_start'::public.break_request_status
     )
     AND started_at IS NULL
     AND COALESCE(planned_start, approved_at_time, requested_at) <= now()
   ORDER BY COALESCE(planned_start, approved_at_time, requested_at) ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN 0;
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
    r.id, r.user_id, COALESCE(auth.uid(), r.user_id), 'started',
    jsonb_build_object('started_at', v_start, 'ends_at', v_start + make_interval(mins => COALESCE(v_dur, 15))),
    r.branch_id
  );

  BEGIN
    INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
    VALUES (r.user_id, NULL, 'ההפסקה שלך התחילה', r.branch_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_due_breaks_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_due_breaks_for_user(uuid) TO authenticated, service_role;

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
