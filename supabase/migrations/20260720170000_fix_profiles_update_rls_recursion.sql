-- Fix infinite recursion on profiles UPDATE/INSERT/DELETE.
--
-- Root cause: "Branch admins can * scoped profiles" policies OR-in an
-- EXISTS (SELECT … FROM user_task_permissions …) branch. PostgreSQL evaluates
-- every OR branch while checking profiles RLS. That subquery runs under
-- user_task_permissions RLS and eventually re-enters profiles policies.
--
-- Fix: read task permissions through SECURITY DEFINER helpers with
-- row_security off, and route profile write checks through one helper.

CREATE OR REPLACE FUNCTION public.has_edit_employee_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_task_permissions p
    WHERE p.user_id = _user_id
      AND p.can_edit_employee = true
  );
$$;

CREATE OR REPLACE FUNCTION public.has_add_employee_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_task_permissions p
    WHERE p.user_id = _user_id
      AND p.can_add_employee = true
  );
$$;

CREATE OR REPLACE FUNCTION public.has_delete_employee_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_task_permissions p
    WHERE p.user_id = _user_id
      AND p.can_delete_employee = true
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_edit_employee_perm(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_add_employee_perm(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_delete_employee_perm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_edit_employee_perm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_add_employee_perm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_delete_employee_perm(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_write_profile_in_active_branch(_branch_id uuid, _mode text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_active uuid;
BEGIN
  IF v_uid IS NULL OR _branch_id IS NULL THEN
    RETURN false;
  END IF;

  v_active := public.current_active_branch();
  IF v_active IS NULL OR _branch_id <> v_active THEN
    RETURN false;
  END IF;

  IF public.has_role(v_uid, 'main_admin'::public.app_role)
     OR public.is_system_admin(v_uid)
     OR public.has_role(v_uid, 'branch_manager'::public.app_role) THEN
    RETURN true;
  END IF;

  IF public.has_role(v_uid, 'assistant_manager'::public.app_role) THEN
    IF _mode = 'insert' THEN
      RETURN public.has_add_employee_perm(v_uid);
    ELSIF _mode = 'update' THEN
      RETURN public.has_edit_employee_perm(v_uid);
    ELSIF _mode = 'delete' THEN
      RETURN public.has_delete_employee_perm(v_uid);
    END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_write_profile_in_active_branch(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_profile_in_active_branch(uuid, text) TO authenticated, service_role;

-- Rewrite profile write policies without inline user_task_permissions subqueries.
DROP POLICY IF EXISTS "Branch admins can update scoped profiles" ON public.profiles;
CREATE POLICY "Branch admins can update scoped profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.can_write_profile_in_active_branch(branch_id, 'update'))
WITH CHECK (public.can_write_profile_in_active_branch(branch_id, 'update'));

DROP POLICY IF EXISTS "Branch admins can insert scoped profiles" ON public.profiles;
CREATE POLICY "Branch admins can insert scoped profiles"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_profile_in_active_branch(branch_id, 'insert'));

DROP POLICY IF EXISTS "Branch admins can delete scoped profiles" ON public.profiles;
CREATE POLICY "Branch admins can delete scoped profiles"
ON public.profiles
FOR DELETE
TO authenticated
USING (public.can_write_profile_in_active_branch(branch_id, 'delete'));

-- Other helpers that still read profiles under RLS during policy checks.
CREATE OR REPLACE FUNCTION public.get_my_department_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT department_id
  FROM public.profile_scope_internal(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.can_manage_user_role_in_active_branch(_target_user_id uuid, _target_role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_scope_internal(_target_user_id) target
    WHERE (
        public.current_active_branch() IS NULL
        OR target.branch_id = public.current_active_branch()
      )
      AND (
        public.has_role(auth.uid(), 'main_admin'::public.app_role)
        OR public.is_system_admin(auth.uid())
        OR (
          public.has_role(auth.uid(), 'branch_manager'::public.app_role)
          AND target.branch_id = public.current_active_branch()
          AND _target_user_id <> auth.uid()
          AND _target_role IN (
            'assistant_manager'::public.app_role,
            'department_manager'::public.app_role,
            'employee'::public.app_role
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.user_roles protected
            WHERE protected.user_id = _target_user_id
              AND protected.role IN (
                'system_admin'::public.app_role,
                'main_admin'::public.app_role,
                'branch_manager'::public.app_role
              )
          )
        )
      )
  );
$$;

DROP POLICY IF EXISTS "Branch admins can view scoped roles" ON public.user_roles;
CREATE POLICY "Branch admins can view scoped roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'main_admin'::public.app_role)
  OR public.is_system_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.profile_scope_internal(user_roles.user_id) target
      WHERE target.branch_id = public.current_active_branch()
    )
  )
);

-- archive_employee: log before profile delete (FK), allow platform owner.
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
    OR public.is_system_admin(auth.uid())
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
    IF NOT (public.has_role(auth.uid(), 'main_admin'::public.app_role) OR public.is_system_admin(auth.uid())) THEN
      RAISE EXCEPTION 'רק בעל המערכת יכול למחוק מנהל';
    END IF;
  END IF;

  IF COALESCE(p.is_active, true) THEN
    RAISE EXCEPTION 'יש לסמן את העובד כלא פעיל לפני המחיקה הסופית';
  END IF;

  IF NOT (public.has_role(auth.uid(), 'main_admin'::public.app_role) OR public.is_system_admin(auth.uid())) THEN
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

  INSERT INTO public.profile_status_log(profile_id, actor_id, action, note, branch_id)
  VALUES (_user_id, auth.uid(), 'archived', _reason, _active_branch_id);

  UPDATE public.departments SET manager_id = NULL
   WHERE manager_id = _user_id
     AND branch_id = _active_branch_id;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id AND branch_id = _active_branch_id;

  RETURN _arch_id;
END;
$$;
