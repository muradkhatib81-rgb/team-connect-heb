-- Control Log / יומן בקרה / سجل الرقابة
-- Isolated tables + RPCs. Does NOT alter user_roles, user_task_permissions,
-- or existing business RLS. Platform owner enables scopes and grants capabilities.

-- ---------------------------------------------------------------------------
-- 1) Error types (platform owner defines the catalog)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ops_error_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_he text NOT NULL,
  name_ar text NULL,
  name_en text NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_error_types_active_idx
  ON public.ops_error_types (is_active, sort_order);

-- ---------------------------------------------------------------------------
-- 2) Feature enable: company OR branch (empty table = feature off everywhere)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ops_error_feature_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  granted_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_error_feature_scopes_one_target CHECK (
    (company_id IS NOT NULL AND branch_id IS NULL)
    OR (company_id IS NULL AND branch_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ops_error_feature_scopes_company_uidx
  ON public.ops_error_feature_scopes (company_id)
  WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ops_error_feature_scopes_branch_uidx
  ON public.ops_error_feature_scopes (branch_id)
  WHERE branch_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Per-user capability grants (isolated — NOT user_task_permissions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ops_error_user_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  can_log boolean NOT NULL DEFAULT false,
  can_view_log boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  granted_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_error_user_grants_user_branch UNIQUE (user_id, branch_id),
  CONSTRAINT ops_error_user_grants_any_cap CHECK (
    can_log OR can_view_log OR can_delete
  )
);

CREATE INDEX IF NOT EXISTS ops_error_user_grants_branch_idx
  ON public.ops_error_user_grants (branch_id);

-- ---------------------------------------------------------------------------
-- 4) Error entries (monthly via year_month; annual via year_num)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ops_error_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  employee_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  error_type_id uuid NOT NULL REFERENCES public.ops_error_types(id) ON DELETE RESTRICT,
  note text NULL,
  image_path text NULL,
  year_month text NOT NULL,
  year_num integer NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_error_entries_year_month_fmt CHECK (year_month ~ '^\d{4}-\d{2}$')
);

CREATE INDEX IF NOT EXISTS ops_error_entries_branch_month_idx
  ON public.ops_error_entries (branch_id, year_month DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS ops_error_entries_dept_idx
  ON public.ops_error_entries (department_id, year_month DESC);

CREATE INDEX IF NOT EXISTS ops_error_entries_employee_idx
  ON public.ops_error_entries (employee_id, year_month DESC)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ops_error_entries_year_idx
  ON public.ops_error_entries (branch_id, year_num DESC);

-- ---------------------------------------------------------------------------
-- 5) Monthly archive snapshots (kept for annual review / AI)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ops_error_month_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  year_month text NOT NULL,
  year_num integer NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_error_month_archives_ym UNIQUE (branch_id, year_month)
);

-- ---------------------------------------------------------------------------
-- Grants / RLS (owner admin on config tables; entries via definer RPCs)
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.ops_error_types FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ops_error_feature_scopes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ops_error_user_grants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ops_error_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ops_error_month_archives FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_error_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_error_feature_scopes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_error_user_grants TO authenticated;
GRANT SELECT ON public.ops_error_entries TO authenticated;
GRANT SELECT ON public.ops_error_month_archives TO authenticated;
GRANT ALL ON public.ops_error_types TO service_role;
GRANT ALL ON public.ops_error_feature_scopes TO service_role;
GRANT ALL ON public.ops_error_user_grants TO service_role;
GRANT ALL ON public.ops_error_entries TO service_role;
GRANT ALL ON public.ops_error_month_archives TO service_role;

ALTER TABLE public.ops_error_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_error_feature_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_error_user_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_error_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_error_month_archives ENABLE ROW LEVEL SECURITY;

-- Types: everyone authenticated can read active catalog; owner writes
DROP POLICY IF EXISTS ops_error_types_select ON public.ops_error_types;
CREATE POLICY ops_error_types_select ON public.ops_error_types
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS ops_error_types_owner_write ON public.ops_error_types;
CREATE POLICY ops_error_types_owner_write ON public.ops_error_types
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS ops_error_scopes_owner ON public.ops_error_feature_scopes;
CREATE POLICY ops_error_scopes_owner ON public.ops_error_feature_scopes
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS ops_error_grants_owner ON public.ops_error_user_grants;
CREATE POLICY ops_error_grants_owner ON public.ops_error_user_grants
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

-- Entries: SELECT only via visibility helper (no direct INSERT/UPDATE/DELETE for clients)
CREATE OR REPLACE FUNCTION public.ops_error_can_see_entry(_entry public.ops_error_entries)
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
  -- Explicit view grant for this branch
  IF EXISTS (
    SELECT 1 FROM public.ops_error_user_grants g
    WHERE g.user_id = v_uid
      AND g.branch_id = _entry.branch_id
      AND g.can_view_log IS TRUE
  ) THEN
    RETURN true;
  END IF;
  -- Employee: own errors only
  IF _entry.employee_id IS NOT NULL AND _entry.employee_id = v_uid THEN
    RETURN true;
  END IF;
  -- Department head: department + employees in that department
  IF EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = _entry.department_id
      AND d.manager_id = v_uid
  ) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

DROP POLICY IF EXISTS ops_error_entries_select ON public.ops_error_entries;
CREATE POLICY ops_error_entries_select ON public.ops_error_entries
  FOR SELECT TO authenticated
  USING (public.ops_error_can_see_entry(ops_error_entries));

DROP POLICY IF EXISTS ops_error_archives_select ON public.ops_error_month_archives;
CREATE POLICY ops_error_archives_select ON public.ops_error_month_archives
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.ops_error_user_grants g
      WHERE g.user_id = auth.uid()
        AND g.branch_id = ops_error_month_archives.branch_id
        AND g.can_view_log IS TRUE
    )
    OR EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.branch_id = ops_error_month_archives.branch_id
        AND d.manager_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_error_jerusalem_year_month(_ts timestamptz DEFAULT now())
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_char((_ts AT TIME ZONE 'Asia/Jerusalem'), 'YYYY-MM');
$$;

CREATE OR REPLACE FUNCTION public.ops_error_jerusalem_year(_ts timestamptz DEFAULT now())
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (to_char((_ts AT TIME ZONE 'Asia/Jerusalem'), 'YYYY'))::integer;
$$;

CREATE OR REPLACE FUNCTION public.is_ops_error_enabled_for_branch(_branch_id uuid)
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
    SELECT 1 FROM public.ops_error_feature_scopes s
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
    SELECT 1 FROM public.ops_error_feature_scopes s
    WHERE s.enabled IS TRUE AND s.company_id = v_company_id
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_ops_error_enabled_for_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_ops_error_enabled_for_branch(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_ops_error_my_capabilities(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_enabled boolean;
  v_grant public.ops_error_user_grants%ROWTYPE;
  v_is_dept_head boolean;
  v_my_open_count int := 0;
  v_ym text := public.ops_error_jerusalem_year_month();
BEGIN
  IF v_uid IS NULL OR _branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'enabled', false,
      'can_log', false,
      'can_view_log', false,
      'can_delete', false,
      'is_dept_head', false,
      'is_platform_owner', false,
      'month_count', 0,
      'year_month', v_ym
    );
  END IF;

  v_enabled := public.is_ops_error_enabled_for_branch(_branch_id);

  SELECT * INTO v_grant
  FROM public.ops_error_user_grants
  WHERE user_id = v_uid AND branch_id = _branch_id;

  v_is_dept_head := EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.branch_id = _branch_id AND d.manager_id = v_uid
  );

  IF v_enabled THEN
    SELECT count(*)::int INTO v_my_open_count
    FROM public.ops_error_entries e
    WHERE e.branch_id = _branch_id
      AND e.year_month = v_ym
      AND public.ops_error_can_see_entry(e);
  END IF;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'can_log', v_enabled AND COALESCE(v_grant.can_log, false),
    'can_view_log', v_enabled AND (
      public.is_platform_owner(v_uid)
      OR COALESCE(v_grant.can_view_log, false)
      OR v_is_dept_head
      OR EXISTS (
        SELECT 1 FROM public.ops_error_entries e
        WHERE e.branch_id = _branch_id
          AND e.year_month = v_ym
          AND e.employee_id = v_uid
      )
    ),
    'can_delete', v_enabled AND COALESCE(v_grant.can_delete, false),
    'is_dept_head', v_is_dept_head,
    'is_platform_owner', public.is_platform_owner(v_uid),
    'month_count', COALESCE(v_my_open_count, 0),
    'year_month', v_ym,
    -- Card visible if feature on and user has any reason to open it
    'show_card', v_enabled AND (
      public.is_platform_owner(v_uid)
      OR COALESCE(v_grant.can_log, false)
      OR COALESCE(v_grant.can_view_log, false)
      OR COALESCE(v_grant.can_delete, false)
      OR v_is_dept_head
      OR EXISTS (
        SELECT 1 FROM public.ops_error_entries e
        WHERE e.branch_id = _branch_id AND e.employee_id = v_uid AND e.year_month = v_ym
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_ops_error_my_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ops_error_my_capabilities(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Mutations (SECURITY DEFINER) — enforce grants without touching roles
-- ---------------------------------------------------------------------------
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

  -- Image path must live under the uploader's folder (storage policy).
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
  RETURNING id INTO v_id;

  BEGIN
    SELECT * INTO v_row FROM public.ops_error_entries WHERE id = v_id;
    IF FOUND THEN
      PERFORM public.notify_ops_error_entry_created(v_row);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_ops_error_entry(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ops_error_entry(uuid, uuid, uuid, uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_ops_error_entry(_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.ops_error_entries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO r FROM public.ops_error_entries WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  IF NOT public.is_ops_error_enabled_for_branch(r.branch_id) THEN
    RAISE EXCEPTION 'feature_disabled';
  END IF;

  IF NOT public.is_platform_owner(v_uid)
     AND NOT EXISTS (
       SELECT 1 FROM public.ops_error_user_grants g
       WHERE g.user_id = v_uid AND g.branch_id = r.branch_id AND g.can_delete IS TRUE
     )
  THEN
    RAISE EXCEPTION 'no_delete_permission';
  END IF;

  DELETE FROM public.ops_error_entries WHERE id = _id;
  RETURN r.image_path;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_ops_error_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_ops_error_entry(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage: optional photo evidence for an error (private bucket + signed URLs)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
SELECT 'ops-error-images', 'ops-error-images', false
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'ops-error-images');

DROP POLICY IF EXISTS "ops-error-images: read auth" ON storage.objects;
DROP POLICY IF EXISTS "ops-error-images: insert own folder" ON storage.objects;
DROP POLICY IF EXISTS "ops-error-images: delete own or delete-grant" ON storage.objects;

CREATE POLICY "ops-error-images: read auth"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ops-error-images');

CREATE POLICY "ops-error-images: insert own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ops-error-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "ops-error-images: delete own or delete-grant"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'ops-error-images'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.is_platform_owner(auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Monthly archive job (entries stay; snapshot for annual / AI)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_ops_error_previous_month()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text;
  v_year int;
  v_count int := 0;
  r record;
  v_summary jsonb;
BEGIN
  v_prev := to_char(
    ((now() AT TIME ZONE 'Asia/Jerusalem') - interval '1 month'),
    'YYYY-MM'
  );
  v_year := (substr(v_prev, 1, 4))::integer;

  FOR r IN
    SELECT DISTINCT e.branch_id
    FROM public.ops_error_entries e
    WHERE e.year_month = v_prev
  LOOP
    SELECT jsonb_build_object(
      'year_month', v_prev,
      'total', count(*)::int,
      'by_department', coalesce(
        (
          SELECT jsonb_agg(jsonb_build_object(
            'department_id', x.department_id,
            'department_name', x.dept_name,
            'count', x.cnt
          ) ORDER BY x.cnt DESC)
          FROM (
            SELECT e2.department_id, d.name AS dept_name, count(*)::int AS cnt
            FROM public.ops_error_entries e2
            JOIN public.departments d ON d.id = e2.department_id
            WHERE e2.branch_id = r.branch_id AND e2.year_month = v_prev
            GROUP BY e2.department_id, d.name
          ) x
        ),
        '[]'::jsonb
      ),
      'by_type', coalesce(
        (
          SELECT jsonb_agg(jsonb_build_object(
            'error_type_id', y.error_type_id,
            'name_he', y.name_he,
            'count', y.cnt
          ) ORDER BY y.cnt DESC)
          FROM (
            SELECT e3.error_type_id, t.name_he, count(*)::int AS cnt
            FROM public.ops_error_entries e3
            JOIN public.ops_error_types t ON t.id = e3.error_type_id
            WHERE e3.branch_id = r.branch_id AND e3.year_month = v_prev
            GROUP BY e3.error_type_id, t.name_he
          ) y
        ),
        '[]'::jsonb
      )
    ) INTO v_summary
    FROM public.ops_error_entries e
    WHERE e.branch_id = r.branch_id AND e.year_month = v_prev;

    INSERT INTO public.ops_error_month_archives (branch_id, year_month, year_num, summary, archived_at)
    VALUES (r.branch_id, v_prev, v_year, coalesce(v_summary, '{}'::jsonb), now())
    ON CONFLICT (branch_id, year_month) DO UPDATE
      SET summary = EXCLUDED.summary,
          archived_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_ops_error_previous_month() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_ops_error_previous_month() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'archive-ops-error-previous-month') THEN
    PERFORM cron.unschedule('archive-ops-error-previous-month');
  END IF;
  -- 1st of each month at 02:10 Asia/Jerusalem ≈ 23:10 UTC previous day — use 00:15 UTC on 1st as approx.
  PERFORM cron.schedule(
    'archive-ops-error-previous-month',
    '15 0 1 * *',
    $CRON$ SELECT public.archive_ops_error_previous_month(); $CRON$
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- AI / UI summary for current or past month (respects visibility via SELECT policy)
CREATE OR REPLACE FUNCTION public.summarize_ops_errors_for_branch(
  _branch_id uuid,
  _year_month text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ym text := coalesce(nullif(btrim(_year_month), ''), public.ops_error_jerusalem_year_month());
  v_caps jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('enabled', false, 'total', 0);
  END IF;

  v_caps := public.get_ops_error_my_capabilities(_branch_id);
  IF (v_caps->>'enabled')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('enabled', false, 'total', 0, 'year_month', v_ym);
  END IF;
  IF (v_caps->>'show_card')::boolean IS NOT TRUE
     AND (v_caps->>'can_view_log')::boolean IS NOT TRUE
     AND (v_caps->>'is_dept_head')::boolean IS NOT TRUE
     AND NOT public.is_platform_owner(v_uid)
  THEN
    -- Employee may still get personal summary
    NULL;
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'enabled', true,
      'year_month', v_ym,
      'total', count(*)::int,
      'by_department', coalesce(
        (
          SELECT jsonb_agg(jsonb_build_object(
            'department_id', q.department_id,
            'department_name', q.dept_name,
            'count', q.cnt
          ) ORDER BY q.cnt DESC)
          FROM (
            SELECT e.department_id, d.name AS dept_name, count(*)::int AS cnt
            FROM public.ops_error_entries e
            JOIN public.departments d ON d.id = e.department_id
            WHERE e.branch_id = _branch_id
              AND e.year_month = v_ym
              AND public.ops_error_can_see_entry(e)
            GROUP BY e.department_id, d.name
          ) q
        ),
        '[]'::jsonb
      ),
      'by_type', coalesce(
        (
          SELECT jsonb_agg(jsonb_build_object(
            'error_type_id', q2.error_type_id,
            'name_he', q2.name_he,
            'count', q2.cnt
          ) ORDER BY q2.cnt DESC)
          FROM (
            SELECT e.error_type_id, t.name_he, count(*)::int AS cnt
            FROM public.ops_error_entries e
            JOIN public.ops_error_types t ON t.id = e.error_type_id
            WHERE e.branch_id = _branch_id
              AND e.year_month = v_ym
              AND public.ops_error_can_see_entry(e)
            GROUP BY e.error_type_id, t.name_he
          ) q2
        ),
        '[]'::jsonb
      )
    )
    FROM public.ops_error_entries e
    WHERE e.branch_id = _branch_id
      AND e.year_month = v_ym
      AND public.ops_error_can_see_entry(e)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.summarize_ops_errors_for_branch(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.summarize_ops_errors_for_branch(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Push event + realtime + notify helper (also in 20260824210000 for upgrades)
-- ---------------------------------------------------------------------------
INSERT INTO public.platform_push_settings (event_key, push_enabled) VALUES
  ('control_log', true)
ON CONFLICT (event_key) DO NOTHING;

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

  IF _entry.employee_id IS NOT NULL
     AND _entry.employee_id IS DISTINCT FROM _entry.created_by
  THEN
    PERFORM public.notify_with_platform_push(
      _entry.employee_id, v_msg, _entry.branch_id, 'control_log', NULL, 'יומן בקרה'
    );
    v_seen := array_append(v_seen, _entry.employee_id);
  END IF;

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
