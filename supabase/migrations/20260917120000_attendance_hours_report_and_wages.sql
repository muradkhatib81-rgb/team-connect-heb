-- Attendance hours report + per-employee hourly wage.
-- Isolated from user_roles / user_task_permissions / app_role / Permissions page.
-- Hours report access is ONLY Platform Owner or attendance_user_grants.can_report.
-- Do NOT auto-grant can_report to branch_manager, assistant_manager,
-- department_manager, or any role. Do not consult has_role() for report access.
--
-- Data retention (requirement: keep punch history usable ≥ 12 months):
--   * No existing pg_cron / purge job deletes or archives attendance_sessions.
--     (Search of migrations: only messaging, leave, and break crons.)
--   * Soft-delete (deleted_at) is an explicit manager action, not retention.
--   * This migration does NOT add a purge job and does NOT wipe sessions.
--   * COMMENT below documents: do not auto-purge attendance_sessions for at
--     least 12 months (keep indefinitely unless product later sets ≥ 12 months).

COMMENT ON TABLE public.attendance_sessions IS
  'Clock-in/out pairs. Keep for hours reporting at least 12 months. Do not add auto-purge/TTL jobs against this table.';

-- ---------------------------------------------------------------------------
-- 1) Report grant flag on existing attendance_user_grants (PO-only writes)
-- ---------------------------------------------------------------------------
ALTER TABLE public.attendance_user_grants
  ADD COLUMN IF NOT EXISTS can_report boolean NOT NULL DEFAULT false;

ALTER TABLE public.attendance_user_grants
  ALTER COLUMN branch_id DROP NOT NULL;

ALTER TABLE public.attendance_user_grants
  DROP CONSTRAINT IF EXISTS attendance_user_grants_any_cap;
ALTER TABLE public.attendance_user_grants
  ADD CONSTRAINT attendance_user_grants_any_cap CHECK (
    can_view OR can_edit OR can_delete OR can_report
  );

ALTER TABLE public.attendance_user_grants
  DROP CONSTRAINT IF EXISTS attendance_user_grants_user_branch;

-- Branch-scoped grants stay unique per (user, branch).
CREATE UNIQUE INDEX IF NOT EXISTS attendance_user_grants_user_branch_uidx
  ON public.attendance_user_grants (user_id, branch_id)
  WHERE branch_id IS NOT NULL;

-- Company-wide grants (companies with no assigned branches).
CREATE UNIQUE INDEX IF NOT EXISTS attendance_user_grants_user_company_uidx
  ON public.attendance_user_grants (user_id, company_id)
  WHERE branch_id IS NULL AND company_id IS NOT NULL;

ALTER TABLE public.attendance_user_grants
  DROP CONSTRAINT IF EXISTS attendance_user_grants_scope_chk;
ALTER TABLE public.attendance_user_grants
  ADD CONSTRAINT attendance_user_grants_scope_chk CHECK (
    branch_id IS NOT NULL
    OR (branch_id IS NULL AND company_id IS NOT NULL)
  );

-- Shared sync trigger nulls company_id when branch_id is null — replace for grants only.
DROP TRIGGER IF EXISTS trg_attendance_user_grants_sync_company ON public.attendance_user_grants;

CREATE OR REPLACE FUNCTION public.sync_attendance_user_grant_company_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF NEW.branch_id IS NOT NULL THEN
    NEW.company_id := public.company_id_of_branch(NEW.branch_id);
  ELSIF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_OR_BRANCH_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_user_grants_sync_company_id ON public.attendance_user_grants;
CREATE TRIGGER trg_attendance_user_grants_sync_company_id
  BEFORE INSERT OR UPDATE OF branch_id, company_id ON public.attendance_user_grants
  FOR EACH ROW EXECUTE FUNCTION public.sync_attendance_user_grant_company_id();

-- ---------------------------------------------------------------------------
-- 2) Per-employee hourly wage (PII). Direct table access = Platform Owner only.
--    Report viewers read rates only via SECURITY DEFINER report RPC.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_hourly_wages (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  hourly_rate numeric(12,2) NOT NULL CHECK (hourly_rate >= 0 AND hourly_rate <= 100000),
  currency text NOT NULL DEFAULT 'ILS',
  updated_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employee_hourly_wages IS
  'Per-employee hourly rate for attendance hours pay estimate. Not a company-wide rate.';

REVOKE ALL ON public.employee_hourly_wages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_hourly_wages TO authenticated;
GRANT ALL ON public.employee_hourly_wages TO service_role;

ALTER TABLE public.employee_hourly_wages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_hourly_wages_owner ON public.employee_hourly_wages;
CREATE POLICY employee_hourly_wages_owner ON public.employee_hourly_wages
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3) Duration helpers (Asia/Jerusalem day bounds)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_jerusalem_range(_from date, _to date)
RETURNS TABLE(range_start timestamptz, range_end timestamptz)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    (_from::timestamp AT TIME ZONE 'Asia/Jerusalem') AS range_start,
    ((_to + 1)::timestamp AT TIME ZONE 'Asia/Jerusalem') AS range_end;
$$;

CREATE OR REPLACE FUNCTION public.attendance_clipped_seconds(
  _clock_in timestamptz,
  _clock_out timestamptz,
  _range_start timestamptz,
  _range_end timestamptz
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _clock_in IS NULL OR _clock_out IS NULL OR _range_start IS NULL OR _range_end IS NULL THEN 0
    WHEN _clock_out < _clock_in THEN 0
    WHEN LEAST(_clock_out, _range_end) <= GREATEST(_clock_in, _range_start) THEN 0
    ELSE EXTRACT(EPOCH FROM (
      LEAST(_clock_out, _range_end) - GREATEST(_clock_in, _range_start)
    ))
  END;
$$;

REVOKE ALL ON FUNCTION public.attendance_jerusalem_range(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_clipped_seconds(timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_jerusalem_range(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attendance_clipped_seconds(timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.attendance_company_branch_count(_company_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COUNT(*)::integer
  FROM public.company_branch_assignments cba
  WHERE cba.company_id = _company_id
    AND cba.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.attendance_company_branch_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_company_branch_count(uuid) TO authenticated, service_role;

-- Report gate: is_platform_owner OR attendance_user_grants.can_report for scope.
-- Intentionally ignores user_roles / user_task_permissions / has_role().
CREATE OR REPLACE FUNCTION public.attendance_can_run_hours_report(
  _branch_id uuid,
  _company_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company uuid;
  v_branch_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_platform_owner(v_uid) THEN
    RETURN true;
  END IF;

  IF _branch_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.attendance_user_grants g
      WHERE g.user_id = v_uid
        AND g.branch_id = _branch_id
        AND g.can_report IS TRUE
    );
  END IF;

  IF _company_id IS NULL THEN
    RETURN false;
  END IF;

  v_company := _company_id;
  v_branch_count := public.attendance_company_branch_count(v_company);
  -- Company-wide report is only for companies with no assigned branches.
  IF v_branch_count > 0 THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.attendance_user_grants g
    WHERE g.user_id = v_uid
      AND g.company_id = v_company
      AND g.branch_id IS NULL
      AND g.can_report IS TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attendance_can_run_hours_report(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_can_run_hours_report(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Capabilities: add can_report (does NOT imply can_view / manager card)
-- ---------------------------------------------------------------------------
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
  v_on_leave boolean;
  v_has_shift boolean := false;
  v_on_mgmt boolean := false;
  v_branch_ok boolean := false;
  v_active boolean := false;
  v_title_ok boolean := false;
  v_can_punch boolean := false;
  v_can_view boolean := false;
  v_can_edit boolean := false;
  v_can_delete boolean := false;
  v_can_report boolean := false;
  v_hide_reason text := null;
  v_show_employee boolean := false;
BEGIN
  IF v_uid IS NULL OR _branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'enabled', false,
      'can_punch', false,
      'can_view', false,
      'can_edit', false,
      'can_delete', false,
      'can_report', false,
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
    p.department_id,
    p.job_title
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
      'can_report', v_owner,
      'is_platform_owner', v_owner,
      'show_employee_card', false,
      'show_manager_card', false,
      'hide_reason', 'inactive'
    );
  END IF;

  v_active := v_profile.is_active IS TRUE;
  v_branch_ok := v_profile.branch_id IS NOT NULL AND v_profile.branch_id = _branch_id;
  v_on_leave := public.attendance_profile_on_leave_today(v_uid, now());
  v_title_ok := public.attendance_user_allows_punch(v_uid);
  v_on_mgmt := public.is_management_on_shift(v_uid, _branch_id);
  v_has_shift := public.attendance_has_punchable_presence(v_uid, _branch_id, now());

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
  v_can_report := v_owner
    OR COALESCE(v_grant.can_report, false)
    OR EXISTS (
      SELECT 1
      FROM public.attendance_user_grants g2
      WHERE g2.user_id = v_uid
        AND g2.can_report IS TRUE
        AND g2.branch_id IS NULL
        AND g2.company_id IS NOT NULL
        AND public.attendance_company_branch_count(g2.company_id) = 0
        AND (
          g2.company_id = public.company_id_of_branch(_branch_id)
          OR g2.company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = v_uid)
        )
    );

  IF NOT v_enabled THEN
    v_hide_reason := 'feature_disabled';
  ELSIF NOT v_active THEN
    v_hide_reason := 'inactive';
  ELSIF NOT v_branch_ok THEN
    v_hide_reason := 'wrong_branch';
  ELSIF NOT v_title_ok THEN
    v_hide_reason := 'role_denied';
  ELSIF v_on_leave THEN
    v_hide_reason := 'on_leave';
  ELSIF NOT v_has_shift THEN
    v_hide_reason := 'no_shift';
  ELSE
    v_can_punch := true;
  END IF;

  v_show_employee := v_enabled AND v_active AND v_branch_ok AND v_title_ok;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'can_punch', v_can_punch,
    'can_view', v_can_view,
    'can_edit', v_can_edit,
    'can_delete', v_can_delete,
    'can_report', v_can_report,
    'is_platform_owner', v_owner,
    'show_employee_card', v_show_employee,
    'show_manager_card', v_enabled AND v_can_view AND (v_owner OR (v_active AND v_branch_ok)),
    'hide_reason', v_hide_reason,
    'has_shift_today', v_has_shift,
    'on_management_shift', v_on_mgmt,
    'on_leave', v_on_leave,
    'branch_match', v_branch_ok,
    'title_allows_punch', v_title_ok
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_my_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_my_capabilities(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Report scopes for nav / branch picker (SECURITY DEFINER: grants are owner-only RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_attendance_report_scopes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner boolean;
  v_scopes jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  v_owner := public.is_platform_owner(v_uid);

  IF v_owner THEN
    SELECT COALESCE(jsonb_agg(x.obj ORDER BY x.sort_name, x.branch_name), '[]'::jsonb)
      INTO v_scopes
    FROM (
      SELECT
        jsonb_build_object(
          'company_id', c.id,
          'company_name', c.name,
          'branch_id', NULL,
          'branch_name', NULL,
          'has_branches', false,
          'scope_kind', 'company'
        ) AS obj,
        c.name AS sort_name,
        '' AS branch_name
      FROM public.companies c
      WHERE c.deleted_at IS NULL
        AND public.attendance_company_branch_count(c.id) = 0
      UNION ALL
      SELECT
        jsonb_build_object(
          'company_id', c.id,
          'company_name', c.name,
          'branch_id', cba.source_branch_id,
          'branch_name', COALESCE(b.name, cba.name, cba.source_branch_id::text),
          'has_branches', true,
          'scope_kind', 'branch'
        ) AS obj,
        c.name AS sort_name,
        COALESCE(b.name, cba.name, '') AS branch_name
      FROM public.company_branch_assignments cba
      JOIN public.companies c ON c.id = cba.company_id AND c.deleted_at IS NULL
      LEFT JOIN public.branches b ON b.id = cba.source_branch_id
      WHERE cba.deleted_at IS NULL
    ) x;
  ELSE
    SELECT COALESCE(jsonb_agg(x.obj ORDER BY x.sort_name, x.branch_name), '[]'::jsonb)
      INTO v_scopes
    FROM (
      SELECT
        jsonb_build_object(
          'company_id', g.company_id,
          'company_name', c.name,
          'branch_id', g.branch_id,
          'branch_name', CASE
            WHEN g.branch_id IS NULL THEN NULL
            ELSE COALESCE(b.name, g.branch_id::text)
          END,
          'has_branches', g.branch_id IS NOT NULL,
          'scope_kind', CASE WHEN g.branch_id IS NULL THEN 'company' ELSE 'branch' END
        ) AS obj,
        COALESCE(c.name, '') AS sort_name,
        COALESCE(b.name, '') AS branch_name
      FROM public.attendance_user_grants g
      LEFT JOIN public.companies c ON c.id = g.company_id
      LEFT JOIN public.branches b ON b.id = g.branch_id
      WHERE g.user_id = v_uid
        AND g.can_report IS TRUE
        AND (
          g.branch_id IS NOT NULL
          OR (
            g.branch_id IS NULL
            AND g.company_id IS NOT NULL
            AND public.attendance_company_branch_count(g.company_id) = 0
          )
        )
    ) x;
  END IF;

  RETURN jsonb_build_object(
    'is_platform_owner', v_owner,
    'can_report', v_owner OR jsonb_array_length(v_scopes) > 0,
    'scopes', COALESCE(v_scopes, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_attendance_report_scopes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_attendance_report_scopes() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_attendance_report_employees(
  _branch_id uuid,
  _company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF NOT public.attendance_can_run_hours_report(_branch_id, _company_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF _branch_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'id_number', p.id_number
    ) ORDER BY p.full_name), '[]'::jsonb)
    INTO v_rows
    FROM public.profiles p
    WHERE p.branch_id = _branch_id;
  ELSE
    IF _company_id IS NULL THEN
      RAISE EXCEPTION 'COMPANY_OR_BRANCH_REQUIRED';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'id_number', p.id_number
    ) ORDER BY p.full_name), '[]'::jsonb)
    INTO v_rows
    FROM public.profiles p
    WHERE p.company_id = _company_id;
  END IF;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_attendance_report_employees(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_attendance_report_employees(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Hours report RPC
--    filter: all | punchers | one  (one requires _employee_id)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_attendance_hours_report(
  _from date,
  _to date,
  _branch_id uuid,
  _company_id uuid,
  _filter text,
  _employee_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
  v_filter text := lower(COALESCE(_filter, 'punchers'));
  v_rows jsonb;
  v_totals jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;
  IF _to > _from + 400 THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;
  IF v_filter NOT IN ('all', 'punchers', 'one') THEN
    RAISE EXCEPTION 'INVALID_FILTER';
  END IF;
  IF v_filter = 'one' AND _employee_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_REQUIRED';
  END IF;
  IF _branch_id IS NULL AND _company_id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_OR_BRANCH_REQUIRED';
  END IF;
  IF _branch_id IS NOT NULL AND public.attendance_company_branch_count(COALESCE(_company_id, public.company_id_of_branch(_branch_id))) = 0
     AND _company_id IS NOT NULL THEN
    -- Allow PO/grantee to still run per-branch if a branch id was passed;
    -- company-wide path is the no-branch case below.
    NULL;
  END IF;
  IF _branch_id IS NULL AND public.attendance_company_branch_count(_company_id) > 0 THEN
    RAISE EXCEPTION 'BRANCH_REQUIRED';
  END IF;
  IF NOT public.attendance_can_run_hours_report(_branch_id, _company_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT r.range_start, r.range_end
    INTO v_start, v_end
  FROM public.attendance_jerusalem_range(_from, _to) r;

  WITH scoped_profiles AS (
    SELECT p.id, p.full_name, p.id_number
    FROM public.profiles p
    WHERE
      CASE
        WHEN _employee_id IS NOT NULL THEN p.id = _employee_id
        WHEN _branch_id IS NOT NULL THEN p.branch_id = _branch_id
        ELSE p.company_id = _company_id
      END
  ),
  hours AS (
    SELECT
      s.user_id,
      SUM(public.attendance_clipped_seconds(s.clock_in_at, s.clock_out_at, v_start, v_end)) AS seconds
    FROM public.attendance_sessions s
    WHERE s.deleted_at IS NULL
      AND s.clock_out_at IS NOT NULL
      AND s.clock_in_at < v_end
      AND s.clock_out_at > v_start
      AND (
        CASE
          WHEN _branch_id IS NOT NULL THEN s.branch_id = _branch_id
          ELSE (
            s.company_id = _company_id
            OR s.user_id IN (SELECT id FROM scoped_profiles)
          )
        END
      )
      AND (_employee_id IS NULL OR s.user_id = _employee_id)
    GROUP BY s.user_id
  ),
  combined AS (
    SELECT
      p.id AS user_id,
      p.full_name,
      p.id_number,
      COALESCE(h.seconds, 0)::double precision AS seconds,
      w.hourly_rate
    FROM scoped_profiles p
    LEFT JOIN hours h ON h.user_id = p.id
    LEFT JOIN public.employee_hourly_wages w ON w.user_id = p.id
    UNION
    SELECT
      h.user_id,
      COALESCE(pr.full_name, h.user_id::text),
      pr.id_number,
      h.seconds::double precision,
      w.hourly_rate
    FROM hours h
    LEFT JOIN public.profiles pr ON pr.id = h.user_id
    LEFT JOIN public.employee_hourly_wages w ON w.user_id = h.user_id
    WHERE NOT EXISTS (SELECT 1 FROM scoped_profiles sp WHERE sp.id = h.user_id)
      AND v_filter <> 'one'
  ),
  filtered AS (
    SELECT DISTINCT ON (c.user_id)
      c.user_id,
      c.full_name,
      c.id_number,
      c.seconds,
      ROUND((c.seconds / 60.0)::numeric)::integer AS total_minutes,
      ROUND((c.seconds / 3600.0)::numeric, 2) AS total_hours,
      c.hourly_rate,
      CASE
        WHEN c.hourly_rate IS NULL THEN NULL
        ELSE ROUND(ROUND((c.seconds / 3600.0)::numeric, 2) * c.hourly_rate, 2)
      END AS estimated_pay
    FROM combined c
    WHERE
      CASE v_filter
        WHEN 'punchers' THEN c.seconds > 0
        WHEN 'one' THEN c.user_id = _employee_id
        ELSE true
      END
    ORDER BY c.user_id, c.seconds DESC
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'user_id', f.user_id,
        'full_name', f.full_name,
        'id_number', f.id_number,
        'total_seconds', f.seconds,
        'total_minutes', f.total_minutes,
        'total_hours', f.total_hours,
        'hourly_rate', f.hourly_rate,
        'estimated_pay', f.estimated_pay
      )
      ORDER BY f.full_name NULLS LAST
    ), '[]'::jsonb),
    jsonb_build_object(
      'total_seconds', COALESCE(SUM(f.seconds), 0),
      'total_minutes', ROUND(COALESCE(SUM(f.seconds), 0) / 60.0)::integer,
      'total_hours', ROUND((COALESCE(SUM(f.seconds), 0) / 3600.0)::numeric, 2),
      'estimated_pay', COALESCE(SUM(f.estimated_pay), 0)
    )
  INTO v_rows, v_totals
  FROM filtered f;

  RETURN jsonb_build_object(
    'ok', true,
    'from', _from,
    'to', _to,
    'branch_id', _branch_id,
    'company_id', _company_id,
    'filter', v_filter,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'totals', COALESCE(v_totals, jsonb_build_object(
      'total_seconds', 0, 'total_minutes', 0, 'total_hours', 0, 'estimated_pay', 0
    ))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_hours_report(date, date, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_hours_report(date, date, uuid, uuid, text, uuid) TO authenticated, service_role;
