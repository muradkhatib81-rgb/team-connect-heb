-- On department transfer: move current + next week schedule shifts into the
-- target department schedule, and retarget open leave/break department_id.
-- Does NOT touch user_task_permissions, roles, or RLS policies.

CREATE OR REPLACE FUNCTION public.transfer_employee_department_data(
  _user_id uuid,
  _from_dept uuid,
  _to_dept uuid,
  _branch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date;
  v_week0 date;
  v_week1 date;
  v_ws date;
  v_we date;
  v_src_sched uuid;
  v_dst_sched uuid;
  v_shift record;
BEGIN
  IF _user_id IS NULL OR _from_dept IS NULL OR _to_dept IS NULL THEN
    RETURN;
  END IF;
  IF _from_dept = _to_dept THEN
    RETURN;
  END IF;

  -- Saturday-start week, matching app getScheduleWeek (UTC date math).
  v_today := (timezone('Asia/Jerusalem', now()))::date;
  v_week0 := v_today - ((EXTRACT(DOW FROM v_today)::integer + 1) % 7);
  v_week1 := v_week0 + 7;

  FOREACH v_ws IN ARRAY ARRAY[v_week0, v_week1]
  LOOP
    v_we := v_ws + 6;

    SELECT s.id INTO v_src_sched
    FROM public.schedules s
    WHERE s.department_id = _from_dept
      AND s.week_start = v_ws
    LIMIT 1;

    IF v_src_sched IS NULL THEN
      CONTINUE;
    END IF;

    -- Skip if employee has no shifts on the source schedule this week.
    IF NOT EXISTS (
      SELECT 1 FROM public.schedule_shifts ss
      WHERE ss.schedule_id = v_src_sched
        AND ss.employee_id = _user_id
    ) THEN
      CONTINUE;
    END IF;

    SELECT s.id INTO v_dst_sched
    FROM public.schedules s
    WHERE s.department_id = _to_dept
      AND s.week_start = v_ws
    LIMIT 1;

    IF v_dst_sched IS NULL THEN
      INSERT INTO public.schedules (
        department_id,
        week_start,
        week_end,
        status,
        schedule_type,
        branch_id,
        created_by
      )
      VALUES (
        _to_dept,
        v_ws,
        v_we,
        'draft',
        COALESCE(
          (SELECT cs.schedule_type FROM public.company_settings cs
           WHERE cs.is_active = true
           ORDER BY cs.created_at ASC NULLS LAST
           LIMIT 1),
          'weekly'
        ),
        _branch_id,
        _user_id
      )
      RETURNING id INTO v_dst_sched;
    END IF;

    FOR v_shift IN
      SELECT *
      FROM public.schedule_shifts
      WHERE schedule_id = v_src_sched
        AND employee_id = _user_id
    LOOP
      -- Prefer transferred cell over any empty/existing target cell for same day.
      DELETE FROM public.schedule_shifts
      WHERE schedule_id = v_dst_sched
        AND employee_id = _user_id
        AND day_date = v_shift.day_date;

      UPDATE public.schedule_shifts
         SET schedule_id = v_dst_sched,
             branch_id = COALESCE(branch_id, _branch_id)
       WHERE id = v_shift.id;
    END LOOP;
  END LOOP;

  -- Open leave requests follow the employee to the new department.
  UPDATE public.leave_requests
     SET department_id = _to_dept
   WHERE user_id = _user_id
     AND department_id = _from_dept
     AND status IN (
       'pending_dept'::public.leave_request_status,
       'pending_admin'::public.leave_request_status,
       'approved'::public.leave_request_status
     );

  -- Open / upcoming breaks follow the employee.
  UPDATE public.break_requests
     SET department_id = _to_dept
   WHERE user_id = _user_id
     AND department_id IS NOT DISTINCT FROM _from_dept
     AND status IN (
       'pending_approval'::public.break_request_status,
       'scheduled'::public.break_request_status,
       'waiting_for_start'::public.break_request_status,
       'approved'::public.break_request_status,
       'active'::public.break_request_status
     );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transfer_employee_department_data(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_employee_department_data(uuid, uuid, uuid, uuid)
  TO authenticated, service_role;
