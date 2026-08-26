-- بصمة الدوام: hide punch when not on shift / on leave / inactive / wrong branch.
-- On-leave = profiles leave fields OR approved leave_requests (regular/sick) covering today.
-- Geo stays on branches (once for all current + future employees). Does NOT touch user_roles / user_task_permissions.

-- Mirrors isEmployeeOnLeaveOnDate / isEmployeeCurrentlyOnLeave (profiles fields),
-- plus approved leave_requests covering today (regular + sick).
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

  -- Profile fields (same rules as src/lib/employee-leave.ts)
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

CREATE OR REPLACE FUNCTION public.get_attendance_my_capabilities(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_enabled boolean;
  v_grant public.attendance_user_grants%ROWTYPE;
  v_owner boolean;
  v_profile record;
  v_shift record;
  v_on_leave boolean;
  v_has_shift boolean := false;
  v_branch_ok boolean := false;
  v_active boolean := false;
  v_can_punch boolean := false;
  v_can_view boolean := false;
  v_can_edit boolean := false;
  v_can_delete boolean := false;
  v_hide_reason text := null;
BEGIN
  IF v_uid IS NULL OR _branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'enabled', false,
      'can_punch', false,
      'can_view', false,
      'can_edit', false,
      'can_delete', false,
      'is_platform_owner', false,
      'show_employee_card', false,
      'show_manager_card', false,
      'hide_reason', 'no_context'
    );
  END IF;

  v_owner := public.is_platform_owner(v_uid);
  v_enabled := public.is_attendance_enabled_for_branch(_branch_id);

  SELECT
    p.branch_id,
    COALESCE(p.is_active, false) AS is_active,
    p.department_id
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'enabled', v_enabled,
      'can_punch', false,
      'can_view', false,
      'can_edit', false,
      'can_delete', false,
      'is_platform_owner', v_owner,
      'show_employee_card', false,
      'show_manager_card', false,
      'hide_reason', 'inactive'
    );
  END IF;

  v_active := v_profile.is_active IS TRUE;
  v_branch_ok := v_profile.branch_id IS NOT NULL AND v_profile.branch_id = _branch_id;
  v_on_leave := public.attendance_profile_on_leave_today(v_uid, now());

  SELECT * INTO v_shift
  FROM public.get_employee_shift_bounds(v_uid, now())
  LIMIT 1;
  v_has_shift := FOUND AND v_shift.shift_start IS NOT NULL;

  -- Latest published row for today must be a working shift (not 'off')
  IF v_has_shift THEN
    DECLARE
      v_shift_code text;
    BEGIN
      SELECT ss.shift INTO v_shift_code
      FROM public.schedule_shifts ss
      JOIN public.schedules s ON s.id = ss.schedule_id
      WHERE ss.employee_id = v_uid
        AND ss.day_date = (now() AT TIME ZONE 'Asia/Jerusalem')::date
        AND s.status = 'approved'
        AND s.published_at IS NOT NULL
      ORDER BY ss.updated_at DESC NULLS LAST
      LIMIT 1;
      IF v_shift_code IS NULL OR v_shift_code = 'off' THEN
        v_has_shift := false;
      END IF;
    END;
  END IF;

  SELECT * INTO v_grant
  FROM public.attendance_user_grants g
  WHERE g.user_id = v_uid AND g.branch_id = _branch_id
  LIMIT 1;

  v_can_view := v_owner
    OR COALESCE(v_grant.can_view, false)
    OR COALESCE(v_grant.can_edit, false)
    OR COALESCE(v_grant.can_delete, false);
  v_can_edit := v_owner OR COALESCE(v_grant.can_edit, false);
  v_can_delete := v_owner OR COALESCE(v_grant.can_delete, false);

  -- Punch for employees of this branch only (current + future), when eligible.
  IF NOT v_enabled THEN
    v_hide_reason := 'feature_disabled';
  ELSIF NOT v_active THEN
    v_hide_reason := 'inactive';
  ELSIF NOT v_branch_ok THEN
    v_hide_reason := 'wrong_branch';
  ELSIF v_on_leave THEN
    v_hide_reason := 'on_leave';
  ELSIF NOT v_has_shift THEN
    v_hide_reason := 'no_shift';
  ELSE
    v_can_punch := true;
  END IF;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'can_punch', v_can_punch,
    'can_view', v_can_view,
    'can_edit', v_can_edit,
    'can_delete', v_can_delete,
    'is_platform_owner', v_owner,
    -- Employee punch card: only when they may punch today
    'show_employee_card', v_can_punch,
    -- Manager tools: enabled branch + grant/owner; still require active membership on that branch (or owner)
    'show_manager_card', v_enabled AND v_can_view AND (v_owner OR (v_active AND v_branch_ok)),
    'hide_reason', v_hide_reason,
    'has_shift_today', v_has_shift,
    'on_leave', v_on_leave,
    'branch_match', v_branch_ok
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_my_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_my_capabilities(uuid) TO authenticated, service_role;

-- Harden punch: membership + active + not on leave (shift already checked for clock-in)
CREATE OR REPLACE FUNCTION public.attendance_punch(
  _branch_id uuid,
  _kind text,
  _lat double precision,
  _lng double precision
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_ym text;
  v_shift record;
  v_open public.attendance_sessions%ROWTYPE;
  v_branch record;
  v_dist double precision;
  v_dept uuid;
  v_grace interval := interval '10 minutes';
  v_row public.attendance_sessions%ROWTYPE;
  v_profile record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF _kind IS NULL OR _kind NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'INVALID_KIND';
  END IF;
  IF NOT public.is_attendance_enabled_for_branch(_branch_id) THEN
    RAISE EXCEPTION 'FEATURE_DISABLED';
  END IF;

  SELECT
    p.branch_id,
    COALESCE(p.is_active, false) AS is_active,
    p.department_id
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'INACTIVE';
  END IF;
  IF v_profile.branch_id IS NULL OR v_profile.branch_id <> _branch_id THEN
    RAISE EXCEPTION 'WRONG_BRANCH';
  END IF;
  IF public.attendance_profile_on_leave_today(v_uid, v_now) THEN
    RAISE EXCEPTION 'ON_LEAVE';
  END IF;

  SELECT id, geo_lat, geo_lng, COALESCE(geo_radius_m, 100) AS geo_radius_m
    INTO v_branch
  FROM public.branches
  WHERE id = _branch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRANCH_NOT_FOUND';
  END IF;

  IF v_branch.geo_lat IS NULL OR v_branch.geo_lng IS NULL THEN
    RAISE EXCEPTION 'GEO_NOT_CONFIGURED';
  END IF;

  IF _lat IS NULL OR _lng IS NULL THEN
    RAISE EXCEPTION 'LOCATION_REQUIRED';
  END IF;

  v_dist := public.attendance_haversine_m(v_branch.geo_lat, v_branch.geo_lng, _lat, _lng);
  IF v_dist IS NULL OR v_dist > v_branch.geo_radius_m THEN
    RAISE EXCEPTION 'OUTSIDE_GEOFENCE';
  END IF;

  v_dept := v_profile.department_id;
  v_ym := public.attendance_jerusalem_year_month(v_now);

  SELECT * INTO v_open
  FROM public.attendance_sessions s
  WHERE s.user_id = v_uid
    AND s.deleted_at IS NULL
    AND s.clock_out_at IS NULL
  ORDER BY s.clock_in_at DESC
  LIMIT 1;

  IF _kind = 'in' THEN
    IF FOUND THEN
      RAISE EXCEPTION 'ALREADY_CLOCKED_IN';
    END IF;

    SELECT * INTO v_shift
    FROM public.get_employee_shift_bounds(v_uid, v_now)
    LIMIT 1;

    IF NOT FOUND OR v_shift.shift_start IS NULL THEN
      RAISE EXCEPTION 'NO_SHIFT_TODAY';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT ss.shift
        FROM public.schedule_shifts ss
        JOIN public.schedules s ON s.id = ss.schedule_id
        WHERE ss.employee_id = v_uid
          AND ss.day_date = (v_now AT TIME ZONE 'Asia/Jerusalem')::date
          AND s.status = 'approved'
          AND s.published_at IS NOT NULL
        ORDER BY ss.updated_at DESC NULLS LAST
        LIMIT 1
      ) t
      WHERE t.shift IS NULL OR t.shift = 'off'
    ) THEN
      RAISE EXCEPTION 'NO_SHIFT_TODAY';
    END IF;

    IF v_now < (v_shift.shift_start - v_grace) THEN
      RAISE EXCEPTION 'TOO_EARLY';
    END IF;

    INSERT INTO public.attendance_sessions (
      user_id, branch_id, department_id,
      clock_in_at, clock_in_lat, clock_in_lng,
      year_month, source
    ) VALUES (
      v_uid, _branch_id, v_dept,
      v_now, _lat, _lng,
      v_ym, 'punch'
    )
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
      'ok', true,
      'kind', 'in',
      'session', to_jsonb(v_row),
      'shift_start', v_shift.shift_start,
      'shift_end', v_shift.shift_end,
      'distance_m', round(v_dist::numeric, 1)
    );
  END IF;

  -- out
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_CLOCKED_IN';
  END IF;

  UPDATE public.attendance_sessions
  SET
    clock_out_at = v_now,
    clock_out_lat = _lat,
    clock_out_lng = _lng,
    updated_at = v_now
  WHERE id = v_open.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', 'out',
    'session', to_jsonb(v_row),
    'distance_m', round(v_dist::numeric, 1),
    'duration_minutes', GREATEST(
      0,
      CEIL(EXTRACT(EPOCH FROM (v_row.clock_out_at - v_row.clock_in_at)) / 60.0)::integer
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attendance_punch(uuid, text, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_punch(uuid, text, double precision, double precision) TO authenticated, service_role;
