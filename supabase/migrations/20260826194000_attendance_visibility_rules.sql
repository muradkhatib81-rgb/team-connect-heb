-- Attendance visibility: treat approved leave_requests (regular + sick) covering today
-- as on-leave for punch hide/block. Geo stays on branches (once for all employees).
-- Does NOT touch user_roles / user_task_permissions.

CREATE OR REPLACE FUNCTION public.attendance_profile_on_leave_today(_user_id uuid, _at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := (_at AT TIME ZONE 'Asia/Jerusalem')::date;
  v_on_leave boolean;
  v_start date;
  v_end date;
BEGIN
  SELECT
    COALESCE(p.on_leave, false),
    p.leave_start_date::date,
    p.leave_end_date::date
  INTO v_on_leave, v_start, v_end
  FROM public.profiles p
  WHERE p.id = _user_id;

  IF NOT FOUND THEN
    RETURN true;
  END IF;

  -- Profile fields (same rules as src/lib/employee-leave.ts isEmployeeOnLeaveOnDate)
  IF v_start IS NOT NULL AND v_end IS NOT NULL THEN
    IF v_day >= v_start AND v_day <= v_end THEN
      RETURN true;
    END IF;
  ELSIF v_on_leave THEN
    IF v_start IS NOT NULL THEN
      IF v_day >= v_start THEN
        RETURN true;
      END IF;
    ELSIF v_end IS NOT NULL THEN
      IF v_day <= v_end THEN
        RETURN true;
      END IF;
    ELSE
      -- Legacy: on_leave without dates
      RETURN true;
    END IF;
  END IF;

  -- Approved leave_requests covering today (regular / sick); skip cancellations
  RETURN EXISTS (
    SELECT 1
    FROM public.leave_requests lr
    JOIN public.leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.user_id = _user_id
      AND lr.status = 'approved'
      AND lr.kind IN ('leave', 'extension')
      AND lt.code IN ('regular', 'sick')
      AND lr.start_date <= v_day
      AND lr.end_date >= v_day
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attendance_profile_on_leave_today(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_profile_on_leave_today(uuid, timestamptz) TO authenticated, service_role;
