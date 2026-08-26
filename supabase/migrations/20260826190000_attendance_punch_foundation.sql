-- ============================================================================مة الدوام / Attendance punch — isolated feature.
-- Does NOT alter user_roles, user_task_permissions, or existing business RLS.

-- ---------------------------------------------------------------------------
-- 1) Branch geo for geofence (100m default)
-- ---------------------------------------------------------------------------
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS geo_lat double precision,
  ADD COLUMN IF NOT EXISTS geo_lng double precision,
  ADD COLUMN IF NOT EXISTS geo_radius_m integer NOT NULL DEFAULT 100;

COMMENT ON COLUMN public.branches.geo_lat IS 'Attendance geofence center latitude';
COMMENT ON COLUMN public.branches.geo_lng IS 'Attendance geofence center longitude';
COMMENT ON COLUMN public.branches.geo_radius_m IS 'Attendance geofence radius in meters (default 100)';

-- ---------------------------------------------------------------------------
-- 2) Feature enable: company OR branch (empty = off everywhere)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_feature_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  granted_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_feature_scopes_one_target CHECK (
    (company_id IS NOT NULL AND branch_id IS NULL)
    OR (company_id IS NULL AND branch_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_feature_scopes_company_uidx
  ON public.attendance_feature_scopes (company_id)
  WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_feature_scopes_branch_uidx
  ON public.attendance_feature_scopes (branch_id)
  WHERE branch_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Per-user capability grants (isolated — NOT user_task_permissions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_user_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  can_view boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  granted_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_user_grants_user_branch UNIQUE (user_id, branch_id),
  CONSTRAINT attendance_user_grants_any_cap CHECK (
    can_view OR can_edit OR can_delete
  )
);

CREATE INDEX IF NOT EXISTS attendance_user_grants_branch_idx
  ON public.attendance_user_grants (branch_id);

-- ---------------------------------------------------------------------------
-- 4) Sessions (clock-in / clock-out pairs; soft-delete keeps history by month)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  department_id uuid NULL REFERENCES public.departments(id) ON DELETE SET NULL,
  clock_in_at timestamptz NOT NULL,
  clock_out_at timestamptz NULL,
  clock_in_lat double precision NULL,
  clock_in_lng double precision NULL,
  clock_out_lat double precision NULL,
  clock_out_lng double precision NULL,
  year_month text NOT NULL,
  source text NOT NULL DEFAULT 'punch'
    CHECK (source IN ('punch', 'manual')),
  note text NULL,
  edited_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  edited_at timestamptz NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_sessions_year_month_fmt CHECK (year_month ~ '^\d{4}-\d{2}$'),
  CONSTRAINT attendance_sessions_out_after_in CHECK (
    clock_out_at IS NULL OR clock_out_at >= clock_in_at
  )
);

CREATE INDEX IF NOT EXISTS attendance_sessions_user_month_idx
  ON public.attendance_sessions (user_id, year_month DESC, clock_in_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS attendance_sessions_branch_month_idx
  ON public.attendance_sessions (branch_id, year_month DESC, clock_in_at DESC)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_one_open_uidx
  ON public.attendance_sessions (user_id)
  WHERE clock_out_at IS NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Grants / RLS
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.attendance_feature_scopes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.attendance_user_grants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.attendance_sessions FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_feature_scopes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_user_grants TO authenticated;
GRANT SELECT ON public.attendance_sessions TO authenticated;
GRANT ALL ON public.attendance_feature_scopes TO service_role;
GRANT ALL ON public.attendance_user_grants TO service_role;
GRANT ALL ON public.attendance_sessions TO service_role;

ALTER TABLE public.attendance_feature_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_user_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_scopes_owner ON public.attendance_feature_scopes;
CREATE POLICY attendance_scopes_owner ON public.attendance_feature_scopes
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS attendance_grants_owner ON public.attendance_user_grants;
CREATE POLICY attendance_grants_owner ON public.attendance_user_grants
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

-- Helpers
CREATE OR REPLACE FUNCTION public.attendance_jerusalem_year_month(_ts timestamptz DEFAULT now())
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_char((_ts AT TIME ZONE 'Asia/Jerusalem'), 'YYYY-MM');
$$;

CREATE OR REPLACE FUNCTION public.attendance_haversine_m(
  _lat1 double precision,
  _lng1 double precision,
  _lat2 double precision,
  _lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _lat1 IS NULL OR _lng1 IS NULL OR _lat2 IS NULL OR _lng2 IS NULL THEN NULL
    ELSE (
      2 * 6371000 * asin(least(1.0, sqrt(
        power(sin(radians(_lat2 - _lat1) / 2), 2) +
        cos(radians(_lat1)) * cos(radians(_lat2)) *
        power(sin(radians(_lng2 - _lng1) / 2), 2)
      )))
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_attendance_enabled_for_branch(_branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF _branch_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_feature_scopes s
    WHERE s.enabled IS TRUE AND s.branch_id = _branch_id
  ) THEN
    RETURN true;
  END IF;

  SELECT cba.company_id INTO v_company_id
  FROM public.company_branch_assignments cba
  WHERE cba.source_branch_id = _branch_id
    AND cba.deleted_at IS NULL
  LIMIT 1;

  IF v_company_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.attendance_feature_scopes s
    WHERE s.enabled IS TRUE AND s.company_id = v_company_id
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_attendance_enabled_for_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_attendance_enabled_for_branch(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.attendance_can_see_session(_row public.attendance_sessions)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_platform_owner(v_uid) THEN
    RETURN true;
  END IF;
  IF _row.user_id = v_uid THEN
    RETURN true;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_user_grants g
    WHERE g.user_id = v_uid
      AND g.branch_id = _row.branch_id
      AND (g.can_view OR g.can_edit OR g.can_delete)
  ) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

DROP POLICY IF EXISTS attendance_sessions_select ON public.attendance_sessions;
CREATE POLICY attendance_sessions_select ON public.attendance_sessions
  FOR SELECT TO authenticated
  USING (public.attendance_can_see_session(attendance_sessions));

-- Capabilities for current user at branch
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
      'show_manager_card', false
    );
  END IF;

  v_owner := public.is_platform_owner(v_uid);
  v_enabled := public.is_attendance_enabled_for_branch(_branch_id);

  SELECT * INTO v_grant
  FROM public.attendance_user_grants g
  WHERE g.user_id = v_uid AND g.branch_id = _branch_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'can_punch', v_enabled,
    'can_view', v_owner OR COALESCE(v_grant.can_view, false) OR COALESCE(v_grant.can_edit, false) OR COALESCE(v_grant.can_delete, false),
    'can_edit', v_owner OR COALESCE(v_grant.can_edit, false),
    'can_delete', v_owner OR COALESCE(v_grant.can_delete, false),
    'is_platform_owner', v_owner,
    'show_employee_card', v_enabled,
    'show_manager_card', v_enabled AND (v_owner OR COALESCE(v_grant.can_view, false) OR COALESCE(v_grant.can_edit, false) OR COALESCE(v_grant.can_delete, false))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_my_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_my_capabilities(uuid) TO authenticated, service_role;

-- Punch clock-in / clock-out
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

  SELECT department_id INTO v_dept
  FROM public.profiles
  WHERE id = v_uid;

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

-- Soft-delete session (requires can_delete grant or platform owner)
CREATE OR REPLACE FUNCTION public.attendance_soft_delete_session(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.attendance_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT * INTO v_row FROM public.attendance_sessions WHERE id = _session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF NOT public.is_platform_owner(v_uid)
     AND NOT EXISTS (
       SELECT 1 FROM public.attendance_user_grants g
       WHERE g.user_id = v_uid AND g.branch_id = v_row.branch_id AND g.can_delete
     )
  THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.attendance_sessions
  SET deleted_at = now(), deleted_by = v_uid, updated_at = now()
  WHERE id = _session_id
    AND deleted_at IS NULL
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'session', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.attendance_soft_delete_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_soft_delete_session(uuid) TO authenticated, service_role;

-- Manual edit of session times (requires can_edit)
CREATE OR REPLACE FUNCTION public.attendance_manual_edit_session(
  _session_id uuid,
  _clock_in_at timestamptz,
  _clock_out_at timestamptz,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.attendance_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF _clock_in_at IS NULL THEN
    RAISE EXCEPTION 'CLOCK_IN_REQUIRED';
  END IF;
  IF _clock_out_at IS NOT NULL AND _clock_out_at < _clock_in_at THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;

  SELECT * INTO v_row FROM public.attendance_sessions WHERE id = _session_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF NOT public.is_platform_owner(v_uid)
     AND NOT EXISTS (
       SELECT 1 FROM public.attendance_user_grants g
       WHERE g.user_id = v_uid AND g.branch_id = v_row.branch_id AND g.can_edit
     )
  THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.attendance_sessions
  SET
    clock_in_at = _clock_in_at,
    clock_out_at = _clock_out_at,
    year_month = public.attendance_jerusalem_year_month(_clock_in_at),
    source = 'manual',
    note = COALESCE(_note, note),
    edited_by = v_uid,
    edited_at = now(),
    updated_at = now()
  WHERE id = _session_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'session', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.attendance_manual_edit_session(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_manual_edit_session(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
