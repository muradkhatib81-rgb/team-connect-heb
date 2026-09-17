-- Hours report: multi-select departments (ANY of the selected ids).
-- Empty / null array = all departments in the branch/company scope.
-- Does NOT touch user_roles / user_task_permissions / app_role.
-- Access remains attendance_can_run_hours_report (PO or can_report grant only).

DROP FUNCTION IF EXISTS public.list_attendance_report_employees(uuid, uuid);
DROP FUNCTION IF EXISTS public.list_attendance_report_employees(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_attendance_hours_report(date, date, uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.get_attendance_hours_report(date, date, uuid, uuid, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.list_attendance_report_employees(
  _branch_id uuid,
  _company_id uuid,
  _department_ids uuid[] DEFAULT NULL
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
  v_dept_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF NOT public.attendance_can_run_hours_report(_branch_id, _company_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT x
    FROM unnest(COALESCE(_department_ids, ARRAY[]::uuid[])) AS x
    WHERE x IS NOT NULL
  ) INTO v_dept_ids;
  IF cardinality(v_dept_ids) = 0 THEN
    v_dept_ids := NULL;
  END IF;
  IF v_dept_ids IS NOT NULL AND cardinality(v_dept_ids) > 80 THEN
    RAISE EXCEPTION 'INVALID_DEPARTMENT';
  END IF;
  IF v_dept_ids IS NOT NULL AND EXISTS (
    SELECT 1
    FROM unnest(v_dept_ids) AS x(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.departments d
      WHERE d.id = x.id
        AND (
          (_branch_id IS NOT NULL AND d.branch_id = _branch_id)
          OR (_branch_id IS NULL AND _company_id IS NOT NULL AND d.company_id = _company_id)
        )
    )
  ) THEN
    RAISE EXCEPTION 'INVALID_DEPARTMENT';
  END IF;

  IF _branch_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'id_number', p.id_number,
      'department_id', p.department_id
    ) ORDER BY p.full_name), '[]'::jsonb)
    INTO v_rows
    FROM public.profiles p
    WHERE p.branch_id = _branch_id
      AND (v_dept_ids IS NULL OR p.department_id = ANY(v_dept_ids));
  ELSE
    IF _company_id IS NULL THEN
      RAISE EXCEPTION 'COMPANY_OR_BRANCH_REQUIRED';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'id_number', p.id_number,
      'department_id', p.department_id
    ) ORDER BY p.full_name), '[]'::jsonb)
    INTO v_rows
    FROM public.profiles p
    WHERE p.company_id = _company_id
      AND (v_dept_ids IS NULL OR p.department_id = ANY(v_dept_ids));
  END IF;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_attendance_report_employees(uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_attendance_report_employees(uuid, uuid, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_attendance_hours_report(
  _from date,
  _to date,
  _branch_id uuid,
  _company_id uuid,
  _filter text,
  _employee_id uuid DEFAULT NULL,
  _department_ids uuid[] DEFAULT NULL
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
  v_dept_totals jsonb;
  v_departments jsonb;
  v_dept_ids uuid[];
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
    NULL;
  END IF;
  IF _branch_id IS NULL AND public.attendance_company_branch_count(_company_id) > 0 THEN
    RAISE EXCEPTION 'BRANCH_REQUIRED';
  END IF;
  IF NOT public.attendance_can_run_hours_report(_branch_id, _company_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT x
    FROM unnest(COALESCE(_department_ids, ARRAY[]::uuid[])) AS x
    WHERE x IS NOT NULL
  ) INTO v_dept_ids;
  IF cardinality(v_dept_ids) = 0 THEN
    v_dept_ids := NULL;
  END IF;
  IF v_dept_ids IS NOT NULL AND cardinality(v_dept_ids) > 80 THEN
    RAISE EXCEPTION 'INVALID_DEPARTMENT';
  END IF;
  IF v_dept_ids IS NOT NULL AND EXISTS (
    SELECT 1
    FROM unnest(v_dept_ids) AS x(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.departments d
      WHERE d.id = x.id
        AND (
          (_branch_id IS NOT NULL AND d.branch_id = _branch_id)
          OR (_branch_id IS NULL AND _company_id IS NOT NULL AND d.company_id = _company_id)
        )
    )
  ) THEN
    RAISE EXCEPTION 'INVALID_DEPARTMENT';
  END IF;

  IF v_dept_ids IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name), '[]'::jsonb)
      INTO v_departments
    FROM public.departments d
    WHERE d.id = ANY(v_dept_ids);
  ELSE
    v_departments := '[]'::jsonb;
  END IF;

  SELECT r.range_start, r.range_end
    INTO v_start, v_end
  FROM public.attendance_jerusalem_range(_from, _to) r;

  WITH scoped_profiles AS (
    SELECT p.id, p.full_name, p.id_number, p.department_id
    FROM public.profiles p
    WHERE
      CASE
        WHEN _employee_id IS NOT NULL THEN p.id = _employee_id
        WHEN _branch_id IS NOT NULL THEN p.branch_id = _branch_id
        ELSE p.company_id = _company_id
      END
      AND (v_dept_ids IS NULL OR p.department_id = ANY(v_dept_ids))
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
      p.department_id,
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
      pr.department_id,
      h.seconds::double precision,
      w.hourly_rate
    FROM hours h
    LEFT JOIN public.profiles pr ON pr.id = h.user_id
    LEFT JOIN public.employee_hourly_wages w ON w.user_id = h.user_id
    WHERE NOT EXISTS (SELECT 1 FROM scoped_profiles sp WHERE sp.id = h.user_id)
      AND v_filter <> 'one'
      AND v_dept_ids IS NULL
  ),
  filtered AS (
    SELECT DISTINCT ON (c.user_id)
      c.user_id,
      c.full_name,
      c.id_number,
      c.department_id,
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
  ),
  dept_totals AS (
    SELECT
      f.department_id,
      d.name AS department_name,
      SUM(f.seconds) AS seconds,
      COALESCE(SUM(f.estimated_pay), 0) AS estimated_pay
    FROM filtered f
    LEFT JOIN public.departments d ON d.id = f.department_id
    GROUP BY f.department_id, d.name
  )
  SELECT
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'user_id', f.user_id,
          'full_name', f.full_name,
          'id_number', f.id_number,
          'department_id', f.department_id,
          'department_name', d.name,
          'total_seconds', f.seconds,
          'total_minutes', f.total_minutes,
          'total_hours', f.total_hours,
          'hourly_rate', f.hourly_rate,
          'estimated_pay', f.estimated_pay
        )
        ORDER BY f.full_name NULLS LAST
      )
      FROM filtered f
      LEFT JOIN public.departments d ON d.id = f.department_id
    ), '[]'::jsonb),
    jsonb_build_object(
      'total_seconds', COALESCE((SELECT SUM(f.seconds) FROM filtered f), 0),
      'total_minutes', ROUND(COALESCE((SELECT SUM(f.seconds) FROM filtered f), 0) / 60.0)::integer,
      'total_hours', ROUND((COALESCE((SELECT SUM(f.seconds) FROM filtered f), 0) / 3600.0)::numeric, 2),
      'estimated_pay', COALESCE((SELECT SUM(f.estimated_pay) FROM filtered f), 0)
    ),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'department_id', t.department_id,
          'department_name', t.department_name,
          'total_seconds', t.seconds,
          'total_minutes', ROUND((t.seconds / 60.0)::numeric)::integer,
          'total_hours', ROUND((t.seconds / 3600.0)::numeric, 2),
          'estimated_pay', t.estimated_pay
        )
        ORDER BY t.department_name NULLS LAST
      )
      FROM dept_totals t
    ), '[]'::jsonb)
  INTO v_rows, v_totals, v_dept_totals;

  RETURN jsonb_build_object(
    'ok', true,
    'from', _from,
    'to', _to,
    'branch_id', _branch_id,
    'company_id', _company_id,
    'department_ids', to_jsonb(COALESCE(v_dept_ids, ARRAY[]::uuid[])),
    'departments', COALESCE(v_departments, '[]'::jsonb),
    'department_id', CASE WHEN v_dept_ids IS NOT NULL AND cardinality(v_dept_ids) = 1 THEN v_dept_ids[1] ELSE NULL END,
    'department_name', CASE
      WHEN v_dept_ids IS NOT NULL AND cardinality(v_dept_ids) = 1
        THEN (SELECT d.name FROM public.departments d WHERE d.id = v_dept_ids[1])
      ELSE NULL
    END,
    'filter', v_filter,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'totals', COALESCE(v_totals, jsonb_build_object(
      'total_seconds', 0, 'total_minutes', 0, 'total_hours', 0, 'estimated_pay', 0
    )),
    'department_totals', COALESCE(v_dept_totals, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_hours_report(date, date, uuid, uuid, text, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_hours_report(date, date, uuid, uuid, text, uuid, uuid[]) TO authenticated, service_role;
