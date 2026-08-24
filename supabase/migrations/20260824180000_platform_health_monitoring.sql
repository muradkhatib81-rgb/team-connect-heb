-- Platform-wide health monitoring for Platform Owners.
-- Read-only operational probes; writes only into health tables.
-- Does NOT change roles, permissions, or existing RLS on business tables.

CREATE TABLE IF NOT EXISTS public.platform_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_key text NOT NULL,
  target_kind text NOT NULL
    CHECK (target_kind IN ('platform', 'company', 'branch', 'database', 'api')),
  target_id uuid NULL,
  target_name text NOT NULL DEFAULT '',
  state text NOT NULL
    CHECK (state IN ('healthy', 'degraded', 'down', 'unknown')),
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  message text NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms integer NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_health_snapshots_target_key_uidx UNIQUE (target_key)
);

CREATE INDEX IF NOT EXISTS platform_health_snapshots_state_idx
  ON public.platform_health_snapshots (state, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_health_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_kind text NOT NULL
    CHECK (target_kind IN ('platform', 'company', 'branch', 'database', 'api')),
  target_id uuid NULL,
  target_name text NOT NULL DEFAULT '',
  state text NOT NULL
    CHECK (state IN ('healthy', 'degraded', 'down', 'unknown')),
  severity text NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  event_type text NOT NULL DEFAULT 'issue'
    CHECK (event_type IN ('issue', 'recovery', 'overload')),
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms integer NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_health_events_created_idx
  ON public.platform_health_events (created_at DESC);

CREATE INDEX IF NOT EXISTS platform_health_events_target_idx
  ON public.platform_health_events (target_kind, target_id, created_at DESC);

ALTER TABLE public.platform_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_health_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.platform_health_snapshots TO authenticated;
GRANT SELECT ON public.platform_health_events TO authenticated;
GRANT ALL ON public.platform_health_snapshots TO service_role;
GRANT ALL ON public.platform_health_events TO service_role;

DROP POLICY IF EXISTS platform_health_snapshots_owner_select ON public.platform_health_snapshots;
CREATE POLICY platform_health_snapshots_owner_select
  ON public.platform_health_snapshots
  FOR SELECT TO authenticated
  USING (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS platform_health_events_owner_select ON public.platform_health_events;
CREATE POLICY platform_health_events_owner_select
  ON public.platform_health_events
  FOR SELECT TO authenticated
  USING (public.is_platform_owner(auth.uid()));

CREATE OR REPLACE FUNCTION public.run_platform_health_scan()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_company_ms integer := 0;
  v_branch_ms integer := 0;
  v_db_ms integer := 0;
  v_companies_checked integer := 0;
  v_branches_checked integer := 0;
  v_issues integer := 0;
  v_now timestamptz := now();
  r record;
  v_prev_state text;
  v_state text;
  v_severity text;
  v_message text;
  v_event_type text;
  v_details jsonb;
  v_key text;
  t0 timestamptz;
  v_ok boolean;
  v_total_ms integer;
BEGIN
  -- DB ping
  t0 := clock_timestamp();
  SELECT EXISTS (SELECT 1 FROM public.platform_settings WHERE id = 1) INTO v_ok;
  v_db_ms := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::integer);
  v_state := CASE
    WHEN NOT COALESCE(v_ok, false) THEN 'degraded'
    WHEN v_db_ms >= 1500 THEN 'degraded'
    ELSE 'healthy'
  END;
  v_severity := CASE
    WHEN v_state = 'healthy' THEN 'info'
    WHEN v_db_ms >= 1500 THEN 'warning'
    ELSE 'error'
  END;
  v_message := CASE
    WHEN v_db_ms >= 1500 THEN format('עומס DB: %sms', v_db_ms)
    WHEN NOT COALESCE(v_ok, false) THEN 'platform_settings לא נמצא'
    ELSE format('DB תקין (%sms)', v_db_ms)
  END;
  v_event_type := CASE WHEN v_db_ms >= 1500 THEN 'overload' ELSE 'issue' END;
  v_key := 'database:';
  v_prev_state := NULL;

  SELECT s.state INTO v_prev_state
  FROM public.platform_health_snapshots s
  WHERE s.target_key = v_key;

  INSERT INTO public.platform_health_snapshots AS s
    (target_key, target_kind, target_id, target_name, state, severity, message, details, latency_ms, checked_at, updated_at)
  VALUES
    (v_key, 'database', NULL, 'מסד נתונים', v_state, v_severity, v_message,
     jsonb_build_object('latency_ms', v_db_ms), v_db_ms, v_now, v_now)
  ON CONFLICT (target_key) DO UPDATE SET
    target_name = EXCLUDED.target_name,
    state = EXCLUDED.state,
    severity = EXCLUDED.severity,
    message = EXCLUDED.message,
    details = EXCLUDED.details,
    latency_ms = EXCLUDED.latency_ms,
    checked_at = EXCLUDED.checked_at,
    updated_at = EXCLUDED.updated_at;

  IF v_state <> 'healthy' THEN
    v_issues := v_issues + 1;
    IF v_prev_state IS DISTINCT FROM v_state THEN
      INSERT INTO public.platform_health_events
        (target_kind, target_id, target_name, state, severity, event_type, message, details, latency_ms)
      VALUES
        ('database', NULL, 'מסד נתונים', v_state, v_severity, v_event_type, v_message,
         jsonb_build_object('latency_ms', v_db_ms), v_db_ms);
    END IF;
  ELSIF v_prev_state IS NOT NULL AND v_prev_state <> 'healthy' THEN
    INSERT INTO public.platform_health_events
      (target_kind, target_id, target_name, state, severity, event_type, message, details, latency_ms)
    VALUES
      ('database', NULL, 'מסד נתונים', 'healthy', 'info', 'recovery', 'DB חזר לפעולה תקינה',
       jsonb_build_object('previous', v_prev_state), v_db_ms);
  END IF;

  -- Companies (all non-deleted; future rows included automatically)
  t0 := clock_timestamp();
  FOR r IN
    SELECT
      c.id,
      c.name,
      c.status,
      c.archived_at,
      (
        SELECT count(*)::integer
        FROM public.company_branch_assignments a
        WHERE a.company_id = c.id AND a.deleted_at IS NULL
      ) AS branch_count,
      (
        SELECT count(*)::integer
        FROM public.company_branch_assignments a
        WHERE a.company_id = c.id AND a.deleted_at IS NULL AND a.is_active
      ) AS active_branch_count
    FROM public.companies c
    WHERE c.deleted_at IS NULL
    ORDER BY c.created_at ASC
  LOOP
    v_companies_checked := v_companies_checked + 1;
    v_details := jsonb_build_object(
      'status', r.status,
      'branch_count', r.branch_count,
      'active_branch_count', r.active_branch_count,
      'archived', r.archived_at IS NOT NULL
    );

    IF r.status = 'suspended' OR r.archived_at IS NOT NULL THEN
      v_state := 'degraded';
      v_severity := 'warning';
      v_message := CASE WHEN r.archived_at IS NOT NULL THEN 'חברה בארכיון' ELSE 'חברה מושהית' END;
      v_event_type := 'issue';
    ELSIF r.status = 'inactive' THEN
      v_state := 'degraded';
      v_severity := 'warning';
      v_message := 'חברה לא פעילה';
      v_event_type := 'issue';
    ELSIF COALESCE(r.branch_count, 0) = 0 THEN
      v_state := 'degraded';
      v_severity := 'warning';
      v_message := 'אין סניפים משויכים לחברה';
      v_event_type := 'issue';
    ELSE
      v_state := 'healthy';
      v_severity := 'info';
      v_message := format('תקין · %s סניפים', r.branch_count);
      v_event_type := 'issue';
    END IF;

    v_key := 'company:' || r.id::text;
    v_prev_state := NULL;

    SELECT s.state INTO v_prev_state
    FROM public.platform_health_snapshots s
    WHERE s.target_key = v_key;

    INSERT INTO public.platform_health_snapshots AS s
      (target_key, target_kind, target_id, target_name, state, severity, message, details, latency_ms, checked_at, updated_at)
    VALUES
      (v_key, 'company', r.id, r.name, v_state, v_severity, v_message, v_details, NULL, v_now, v_now)
    ON CONFLICT (target_key) DO UPDATE SET
      target_name = EXCLUDED.target_name,
      state = EXCLUDED.state,
      severity = EXCLUDED.severity,
      message = EXCLUDED.message,
      details = EXCLUDED.details,
      latency_ms = EXCLUDED.latency_ms,
      checked_at = EXCLUDED.checked_at,
      updated_at = EXCLUDED.updated_at;

    IF v_state <> 'healthy' THEN
      v_issues := v_issues + 1;
      IF v_prev_state IS DISTINCT FROM v_state THEN
        INSERT INTO public.platform_health_events
          (target_kind, target_id, target_name, state, severity, event_type, message, details, latency_ms)
        VALUES
          ('company', r.id, r.name, v_state, v_severity, v_event_type, v_message, v_details, NULL);
      END IF;
    ELSIF v_prev_state IS NOT NULL AND v_prev_state <> 'healthy' THEN
      INSERT INTO public.platform_health_events
        (target_kind, target_id, target_name, state, severity, event_type, message, details, latency_ms)
      VALUES
        ('company', r.id, r.name, 'healthy', 'info', 'recovery', 'חברה חזרה למצב תקין',
         jsonb_build_object('previous', v_prev_state), NULL);
    END IF;
  END LOOP;
  v_company_ms := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::integer);

  -- Branches (all operational branches; future rows included automatically)
  t0 := clock_timestamp();
  FOR r IN
    SELECT
      b.id,
      b.name,
      b.code,
      b.is_active,
      (
        SELECT count(*)::integer
        FROM public.departments d
        WHERE d.branch_id = b.id
      ) AS dept_count,
      (
        SELECT count(*)::integer
        FROM public.departments d
        WHERE d.branch_id = b.id AND d.is_active
      ) AS active_dept_count,
      (
        SELECT count(*)::integer
        FROM public.profiles p
        WHERE p.branch_id = b.id AND COALESCE(p.is_active, true) AND p.deactivated_at IS NULL
      ) AS employee_count,
      (
        SELECT count(*)::integer
        FROM public.company_branch_assignments a
        WHERE a.source_branch_id = b.id AND a.deleted_at IS NULL
      ) AS assignment_count
    FROM public.branches b
    ORDER BY b.created_at ASC
  LOOP
    v_branches_checked := v_branches_checked + 1;
    v_details := jsonb_build_object(
      'code', r.code,
      'is_active', r.is_active,
      'dept_count', r.dept_count,
      'active_dept_count', r.active_dept_count,
      'employee_count', r.employee_count,
      'assignment_count', r.assignment_count
    );

    IF NOT COALESCE(r.is_active, false) THEN
      v_state := 'degraded';
      v_severity := 'warning';
      v_message := 'סניף לא פעיל';
      v_event_type := 'issue';
    ELSIF COALESCE(r.assignment_count, 0) = 0 THEN
      v_state := 'degraded';
      v_severity := 'warning';
      v_message := 'סניף ללא שיוך לחברה';
      v_event_type := 'issue';
    ELSIF COALESCE(r.dept_count, 0) = 0 THEN
      v_state := 'degraded';
      v_severity := 'warning';
      v_message := 'אין מחלקות בסניף';
      v_event_type := 'issue';
    ELSE
      v_state := 'healthy';
      v_severity := 'info';
      v_message := format('תקין · %s מחלקות · %s עובדים', r.dept_count, r.employee_count);
      v_event_type := 'issue';
    END IF;

    v_key := 'branch:' || r.id::text;
    v_prev_state := NULL;

    SELECT s.state INTO v_prev_state
    FROM public.platform_health_snapshots s
    WHERE s.target_key = v_key;

    INSERT INTO public.platform_health_snapshots AS s
      (target_key, target_kind, target_id, target_name, state, severity, message, details, latency_ms, checked_at, updated_at)
    VALUES
      (v_key, 'branch', r.id, r.name, v_state, v_severity, v_message, v_details, NULL, v_now, v_now)
    ON CONFLICT (target_key) DO UPDATE SET
      target_name = EXCLUDED.target_name,
      state = EXCLUDED.state,
      severity = EXCLUDED.severity,
      message = EXCLUDED.message,
      details = EXCLUDED.details,
      latency_ms = EXCLUDED.latency_ms,
      checked_at = EXCLUDED.checked_at,
      updated_at = EXCLUDED.updated_at;

    IF v_state <> 'healthy' THEN
      v_issues := v_issues + 1;
      IF v_prev_state IS DISTINCT FROM v_state THEN
        INSERT INTO public.platform_health_events
          (target_kind, target_id, target_name, state, severity, event_type, message, details, latency_ms)
        VALUES
          ('branch', r.id, r.name, v_state, v_severity, v_event_type, v_message, v_details, NULL);
      END IF;
    ELSIF v_prev_state IS NOT NULL AND v_prev_state <> 'healthy' THEN
      INSERT INTO public.platform_health_events
        (target_kind, target_id, target_name, state, severity, event_type, message, details, latency_ms)
      VALUES
        ('branch', r.id, r.name, 'healthy', 'info', 'recovery', 'סניף חזר למצב תקין',
         jsonb_build_object('previous', v_prev_state), NULL);
    END IF;
  END LOOP;
  v_branch_ms := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::integer);

  -- Platform aggregate
  v_total_ms := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::integer);
  v_state := CASE
    WHEN v_total_ms >= 8000 THEN 'degraded'
    WHEN v_issues > 0 THEN 'degraded'
    ELSE 'healthy'
  END;
  v_severity := CASE
    WHEN v_total_ms >= 8000 THEN 'warning'
    WHEN v_issues > 0 THEN 'warning'
    ELSE 'info'
  END;
  v_message := CASE
    WHEN v_total_ms >= 8000 THEN format('בדיקת פלטפורמה איטית (%sms)', v_total_ms)
    WHEN v_issues > 0 THEN format('נמצאו %s ממצאים · חברות %s · סניפים %s', v_issues, v_companies_checked, v_branches_checked)
    ELSE format('פלטפורמה תקינה · חברות %s · סניפים %s', v_companies_checked, v_branches_checked)
  END;
  v_event_type := CASE WHEN v_total_ms >= 8000 THEN 'overload' ELSE 'issue' END;
  v_details := jsonb_build_object(
    'companies_checked', v_companies_checked,
    'branches_checked', v_branches_checked,
    'issues', v_issues,
    'company_scan_ms', v_company_ms,
    'branch_scan_ms', v_branch_ms,
    'db_ms', v_db_ms,
    'total_ms', v_total_ms
  );
  v_key := 'platform:';
  v_prev_state := NULL;

  SELECT s.state INTO v_prev_state
  FROM public.platform_health_snapshots s
  WHERE s.target_key = v_key;

  INSERT INTO public.platform_health_snapshots AS s
    (target_key, target_kind, target_id, target_name, state, severity, message, details, latency_ms, checked_at, updated_at)
  VALUES
    (v_key, 'platform', NULL, 'פלטפורמה', v_state, v_severity, v_message, v_details, v_total_ms, v_now, v_now)
  ON CONFLICT (target_key) DO UPDATE SET
    target_name = EXCLUDED.target_name,
    state = EXCLUDED.state,
    severity = EXCLUDED.severity,
    message = EXCLUDED.message,
    details = EXCLUDED.details,
    latency_ms = EXCLUDED.latency_ms,
    checked_at = EXCLUDED.checked_at,
    updated_at = EXCLUDED.updated_at;

  IF v_total_ms >= 8000 AND v_prev_state IS DISTINCT FROM v_state THEN
    INSERT INTO public.platform_health_events
      (target_kind, target_id, target_name, state, severity, event_type, message, details, latency_ms)
    VALUES
      ('platform', NULL, 'פלטפורמה', v_state, v_severity, v_event_type, v_message, v_details, v_total_ms);
  ELSIF v_prev_state IS NOT NULL AND v_prev_state <> 'healthy' AND v_state = 'healthy' THEN
    INSERT INTO public.platform_health_events
      (target_kind, target_id, target_name, state, severity, event_type, message, details, latency_ms)
    VALUES
      ('platform', NULL, 'פלטפורמה', 'healthy', 'info', 'recovery', 'פלטפורמה חזרה למצב תקין',
       jsonb_build_object('previous', v_prev_state), v_total_ms);
  END IF;

  DELETE FROM public.platform_health_events
  WHERE created_at < now() - interval '30 days';

  DELETE FROM public.platform_health_snapshots s
  WHERE s.target_kind = 'company'
    AND s.target_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = s.target_id AND c.deleted_at IS NULL
    );

  DELETE FROM public.platform_health_snapshots s
  WHERE s.target_kind = 'branch'
    AND s.target_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.branches b WHERE b.id = s.target_id
    );

  RETURN jsonb_build_object(
    'ok', true,
    'companies_checked', v_companies_checked,
    'branches_checked', v_branches_checked,
    'issues', v_issues,
    'duration_ms', v_total_ms,
    'checked_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_platform_health_scan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_platform_health_scan() TO service_role;

COMMENT ON FUNCTION public.run_platform_health_scan() IS
  'Lightweight platform health scan for all companies and branches. Invoked by server cron only.';
