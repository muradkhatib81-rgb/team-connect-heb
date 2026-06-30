
-- =====================================================================
-- Server-side Active Branch architecture
-- =====================================================================
-- Adds a PostgREST-header–driven "active branch" scope. The header
-- x-active-branch is forwarded by every authenticated server-function
-- call and by the browser Supabase client when a system administrator
-- has picked a branch. RLS enforces the scope; non–system-admins can
-- never escape their own branch even if they tamper with the header.

-- 1) Resolver: returns the effective active branch for the current
--    request, or NULL when the caller is a system admin without a
--    header (which means "unrestricted, see all branches" — used by
--    the branches list / global stats).
CREATE OR REPLACE FUNCTION public.current_active_branch()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_header text;
  v_uuid uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_header := nullif(
      current_setting('request.headers', true)::json->>'x-active-branch',
      ''
    );
  EXCEPTION WHEN others THEN
    v_header := NULL;
  END;

  IF public.is_system_admin(v_uid) THEN
    IF v_header IS NULL THEN
      -- No explicit selection: unrestricted (cross-branch admin views).
      RETURN NULL;
    END IF;
    BEGIN
      v_uuid := v_header::uuid;
    EXCEPTION WHEN others THEN
      v_uuid := NULL;
    END;
    RETURN v_uuid;
  END IF;

  -- Every other role is locked to their own branch regardless of header.
  SELECT branch_id INTO v_uuid FROM public.profiles WHERE id = v_uid;
  RETURN v_uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_active_branch() TO authenticated, anon, service_role;

-- 2) BEFORE INSERT trigger: when a row is inserted without a branch_id,
--    set it to the effective active branch (falls back to caller's
--    profile.branch_id so server-side inserts always carry a value).
CREATE OR REPLACE FUNCTION public.set_default_branch_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    NEW.branch_id := public.current_active_branch();
    IF NEW.branch_id IS NULL THEN
      SELECT branch_id INTO NEW.branch_id
        FROM public.profiles WHERE id = auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3) For every branch-scoped table:
--    a) attach the default-branch trigger
--    b) attach a RESTRICTIVE policy that pins all reads/writes to the
--       active branch (or allows everything when the resolver returns
--       NULL, i.e. system admin without a selection).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'announcements','break_requests','break_settings',
    'communications_audit_log','company_settings','departments',
    'employee_archive','employee_of_month','job_titles','messages',
    'profile_status_log','profiles','schedule_audit_log',
    'schedule_notifications','schedule_shifts','schedules',
    'shift_definitions','task_activity_log','task_recurrences',
    'tasks','user_task_permissions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Drop pre-existing copies so the migration is idempotent.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_branch_id ON public.%I;', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_branch_id BEFORE INSERT ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_default_branch_id();', t);

    EXECUTE format('DROP POLICY IF EXISTS branch_scope_restriction ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY branch_scope_restriction ON public.%I
         AS RESTRICTIVE FOR ALL TO authenticated
         USING (
           branch_id IS NULL
           OR public.current_active_branch() IS NULL
           OR branch_id = public.current_active_branch()
         )
         WITH CHECK (
           branch_id IS NULL
           OR public.current_active_branch() IS NULL
           OR branch_id = public.current_active_branch()
         );', t);
  END LOOP;
END;
$$;

-- 4) Sysadmin-only RPC that returns all branches with cross-branch
--    headcount/department/schedule stats. Used by the Branch Management
--    page so the restrictive policy on profiles/departments/schedules
--    doesn't interfere when listing every branch at once.
CREATE OR REPLACE FUNCTION public.get_branches_with_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_system_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_agg(row_to_json(b.*) ORDER BY b.name)
  INTO v
  FROM (
    SELECT
      br.id, br.name, br.code, br.address, br.phone,
      br.timezone, br.is_active, br.manager_id, br.created_at,
      COALESCE((SELECT count(*) FROM public.profiles    p WHERE p.branch_id = br.id), 0)::int  AS employees_count,
      COALESCE((SELECT count(*) FROM public.departments d WHERE d.branch_id = br.id), 0)::int  AS departments_count,
      COALESCE((SELECT count(*) FROM public.schedules   s WHERE s.branch_id = br.id), 0)::int  AS schedules_count,
      COALESCE((SELECT count(*) FROM public.schedules   s WHERE s.branch_id = br.id AND s.status = 'published'), 0)::int AS published_schedules_count
    FROM public.branches br
  ) b;

  RETURN COALESCE(v, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_branches_with_stats() TO authenticated, service_role;
