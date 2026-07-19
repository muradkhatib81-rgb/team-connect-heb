-- Fix break activation: always activate the earliest due break per user.
-- Fix archive_employee: restore branch scoping; main_admin may delete immediately after deactivation.

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
    SELECT DISTINCT ON (user_id) *
    FROM public.break_requests
    WHERE status IN (
      'scheduled'::public.break_request_status,
      'approved'::public.break_request_status,
      'waiting_for_start'::public.break_request_status
    )
      AND started_at IS NULL
      AND COALESCE(planned_start, approved_at_time, requested_at) <= now()
      AND NOT EXISTS (
        SELECT 1 FROM public.break_requests active_row
        WHERE active_row.user_id = break_requests.user_id
          AND active_row.status = 'active'::public.break_request_status
      )
    ORDER BY user_id, COALESCE(planned_start, approved_at_time, requested_at) ASC
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

CREATE OR REPLACE FUNCTION public.archive_employee(_user_id uuid, _reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  _active_branch_id uuid;
  _deact timestamptz;
  _days numeric;
  _arch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'לא ניתן לארכב את החשבון של עצמך'; END IF;
  IF public.is_system_admin(_user_id) THEN RAISE EXCEPTION 'לא ניתן למחוק את בעל המערכת הראשי'; END IF;

  _active_branch_id := public.current_active_branch();
  IF _active_branch_id IS NULL THEN RAISE EXCEPTION 'יש לבחור סניף פעיל'; END IF;

  IF NOT (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.user_task_permissions p0
        WHERE p0.user_id = auth.uid()
          AND p0.can_delete_employee = true
      )
    )
  ) THEN
    RAISE EXCEPTION 'אין הרשאה למחיקת עובד';
  END IF;

  SELECT p2.id, p2.first_name, p2.last_name, p2.full_name, p2.id_number, p2.job_title, p2.phone,
         p2.department_id, p2.avatar_url, p2.is_active, p2.deactivated_at, p2.branch_id,
         d.name AS dept_name
    INTO p
    FROM public.profiles p2
    LEFT JOIN public.departments d ON d.id = p2.department_id
   WHERE p2.id = _user_id
     AND p2.branch_id = _active_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'עובד לא נמצא בסניף הפעיל'; END IF;

  IF public.has_role(_user_id, 'main_admin'::public.app_role)
     OR public.has_role(_user_id, 'branch_manager'::public.app_role) THEN
    IF NOT public.has_role(auth.uid(), 'main_admin'::public.app_role) THEN
      RAISE EXCEPTION 'רק בעל המערכת יכול למחוק מנהל';
    END IF;
  END IF;

  IF COALESCE(p.is_active, true) THEN
    RAISE EXCEPTION 'יש לסמן את העובד כלא פעיל לפני המחיקה הסופית';
  END IF;

  IF NOT public.has_role(auth.uid(), 'main_admin'::public.app_role) THEN
    _deact := COALESCE(p.deactivated_at, now());
    _days := EXTRACT(EPOCH FROM (now() - _deact)) / 86400.0;
    IF _days < 30 THEN
      RAISE EXCEPTION 'ניתן לבצע מחיקה סופית רק לאחר 30 ימים מההשבתה (נותרו % ימים)', CEIL(30 - _days);
    END IF;
  END IF;

  DELETE FROM public.employee_archive
   WHERE branch_id = _active_branch_id
     AND (original_id = _user_id OR (p.id_number IS NOT NULL AND id_number = p.id_number));

  INSERT INTO public.employee_archive(
    original_id, id_number, first_name, last_name, full_name, job_title, phone,
    department_id, department_name, avatar_url, branch_id,
    archived_by, deactivated_at, reason, snapshot
  )
  VALUES (
    p.id, p.id_number, p.first_name, p.last_name, p.full_name, p.job_title, p.phone,
    p.department_id, p.dept_name, p.avatar_url, p.branch_id,
    auth.uid(), COALESCE(p.deactivated_at, now()), _reason,
    jsonb_build_object(
      'id_number', p.id_number,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'full_name', p.full_name,
      'job_title', p.job_title,
      'phone', p.phone,
      'department_id', p.department_id,
      'department_name', p.dept_name,
      'avatar_url', p.avatar_url
    )
  )
  RETURNING id INTO _arch_id;

  UPDATE public.departments SET manager_id = NULL
   WHERE manager_id = _user_id
     AND branch_id = _active_branch_id;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id AND branch_id = _active_branch_id;

  INSERT INTO public.profile_status_log(profile_id, actor_id, action, note, branch_id)
  VALUES (_user_id, auth.uid(), 'archived', _reason, _active_branch_id);

  RETURN _arch_id;
END;
$$;
