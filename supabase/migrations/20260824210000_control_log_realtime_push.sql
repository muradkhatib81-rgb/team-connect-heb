-- Control Log: realtime publication + push on new entry (like breaks/leave).
-- Isolated — does not alter user_roles / user_task_permissions.

-- ---------------------------------------------------------------------------
-- 1) Platform push toggle (owner can disable like break/leave events)
-- ---------------------------------------------------------------------------
INSERT INTO public.platform_push_settings (event_key, push_enabled) VALUES
  ('control_log', true)
ON CONFLICT (event_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Realtime: entries appear live for anyone who can SELECT them (RLS)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ops_error_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ops_error_entries;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Notify recipients on new entry (in-app bell always; push if toggle on)
-- Recipients: tagged employee, department head, users with can_view_log.
-- Creator is never notified.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_ops_error_entry_created(_entry public.ops_error_entries)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dept text;
  v_type text;
  v_emp text;
  v_msg text;
  v_uid uuid;
  v_seen uuid[] := ARRAY[]::uuid[];
BEGIN
  IF _entry.id IS NULL OR _entry.branch_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(btrim(d.name), ''), 'מחלקה') INTO v_dept
  FROM public.departments d WHERE d.id = _entry.department_id;

  SELECT COALESCE(NULLIF(btrim(t.name_he), ''), 'רישום') INTO v_type
  FROM public.ops_error_types t WHERE t.id = _entry.error_type_id;

  IF _entry.employee_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'עובד') INTO v_emp
    FROM public.profiles p WHERE p.id = _entry.employee_id;
  END IF;

  IF v_emp IS NOT NULL THEN
    v_msg := format('רישום חדש ביומן בקרה · %s · %s · %s', v_dept, v_type, v_emp);
  ELSE
    v_msg := format('רישום חדש ביומן בקרה · %s · %s', v_dept, v_type);
  END IF;

  -- Tagged employee
  IF _entry.employee_id IS NOT NULL
     AND _entry.employee_id IS DISTINCT FROM _entry.created_by
  THEN
    PERFORM public.notify_with_platform_push(
      _entry.employee_id, v_msg, _entry.branch_id, 'control_log', NULL, 'יומן בקרה'
    );
    v_seen := array_append(v_seen, _entry.employee_id);
  END IF;

  -- Department head
  FOR v_uid IN
    SELECT d.manager_id
    FROM public.departments d
    WHERE d.id = _entry.department_id
      AND d.manager_id IS NOT NULL
      AND d.manager_id IS DISTINCT FROM _entry.created_by
      AND NOT (d.manager_id = ANY (v_seen))
  LOOP
    PERFORM public.notify_with_platform_push(
      v_uid, v_msg, _entry.branch_id, 'control_log', NULL, 'יומן בקרה'
    );
    v_seen := array_append(v_seen, v_uid);
  END LOOP;

  -- Explicit view-grant holders on this branch
  FOR v_uid IN
    SELECT g.user_id
    FROM public.ops_error_user_grants g
    JOIN public.profiles p ON p.id = g.user_id
    WHERE g.branch_id = _entry.branch_id
      AND g.can_view_log IS TRUE
      AND g.user_id IS DISTINCT FROM _entry.created_by
      AND p.is_active IS DISTINCT FROM false
      AND NOT (g.user_id = ANY (v_seen))
  LOOP
    PERFORM public.notify_with_platform_push(
      v_uid, v_msg, _entry.branch_id, 'control_log', NULL, 'יומן בקרה'
    );
    v_seen := array_append(v_seen, v_uid);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_ops_error_entry_created(public.ops_error_entries) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_ops_error_entry_created(public.ops_error_entries) TO authenticated, service_role;

-- Wire into create RPC (replace body; keep same signature)
CREATE OR REPLACE FUNCTION public.create_ops_error_entry(
  _branch_id uuid,
  _department_id uuid,
  _employee_id uuid,
  _error_type_id uuid,
  _note text DEFAULT NULL,
  _image_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_ym text := public.ops_error_jerusalem_year_month();
  v_year int := public.ops_error_jerusalem_year();
  v_dept_branch uuid;
  v_emp_dept uuid;
  v_img text := NULLIF(btrim(COALESCE(_image_path, '')), '');
  v_row public.ops_error_entries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.is_ops_error_enabled_for_branch(_branch_id) THEN
    RAISE EXCEPTION 'feature_disabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ops_error_user_grants g
    WHERE g.user_id = v_uid AND g.branch_id = _branch_id AND g.can_log IS TRUE
  ) AND NOT public.is_platform_owner(v_uid) THEN
    RAISE EXCEPTION 'no_log_permission';
  END IF;

  SELECT d.branch_id INTO v_dept_branch FROM public.departments d WHERE d.id = _department_id;
  IF v_dept_branch IS DISTINCT FROM _branch_id THEN
    RAISE EXCEPTION 'department_branch_mismatch';
  END IF;

  IF _employee_id IS NOT NULL THEN
    SELECT p.department_id INTO v_emp_dept FROM public.profiles p WHERE p.id = _employee_id;
    IF v_emp_dept IS DISTINCT FROM _department_id THEN
      RAISE EXCEPTION 'employee_department_mismatch';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ops_error_types t WHERE t.id = _error_type_id AND t.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'invalid_error_type';
  END IF;

  IF v_img IS NOT NULL AND split_part(v_img, '/', 1) IS DISTINCT FROM v_uid::text THEN
    RAISE EXCEPTION 'invalid_image_path';
  END IF;

  INSERT INTO public.ops_error_entries (
    branch_id, department_id, employee_id, error_type_id, note, image_path,
    year_month, year_num, created_by
  ) VALUES (
    _branch_id, _department_id, _employee_id, _error_type_id, NULLIF(btrim(_note), ''), v_img,
    v_ym, v_year, v_uid
  )
  RETURNING * INTO v_row;

  BEGIN
    PERFORM public.notify_ops_error_entry_created(v_row);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- never block create on notify failure
  END;

  RETURN v_row.id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_ops_error_entry(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ops_error_entry(uuid, uuid, uuid, uuid, text, text) TO authenticated, service_role;

-- Deep-link control_log pushes to /control-log (other events stay on /dashboard)
CREATE OR REPLACE FUNCTION public.notify_with_platform_push(
  _user_id uuid,
  _message text,
  _branch_id uuid,
  _event_key text,
  _schedule_id uuid DEFAULT NULL,
  _title text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tone text;
  v_payload jsonb;
  v_url text;
BEGIN
  IF _user_id IS NULL OR NULLIF(btrim(_message), '') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.schedule_notifications (user_id, schedule_id, message, branch_id)
    VALUES (_user_id, _schedule_id, btrim(_message), _branch_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  v_tone := CASE _event_key
    WHEN 'break_start' THEN 'break_start'
    WHEN 'break_end' THEN 'break_end'
    WHEN 'break_late' THEN 'break_late'
    ELSE NULL
  END;

  IF NOT public.is_platform_push_enabled(_event_key, _branch_id) THEN
    RETURN;
  END IF;

  v_url := CASE _event_key
    WHEN 'control_log' THEN '/control-log'
    ELSE '/dashboard'
  END;

  v_payload := jsonb_build_object(
    'userIds', jsonb_build_array(_user_id::text),
    'message', btrim(_message),
    'title', COALESCE(NULLIF(btrim(_title), ''), 'מערכת ניהול עובדים'),
    'tag', _event_key || '-' || _user_id::text || '-' || extract(epoch from now())::bigint::text,
    'url', v_url,
    'eventKey', _event_key,
    'branchId', _branch_id
  );

  IF v_tone IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('tone', v_tone);
  END IF;

  PERFORM public.invoke_push_dispatch_hook(v_payload);
END;
$$;
