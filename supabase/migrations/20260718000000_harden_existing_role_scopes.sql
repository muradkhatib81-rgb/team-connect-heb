-- =====================================================================
-- Existing-role authorization scope hardening
-- =====================================================================
-- No Company, Branch, Department, Employee, or identifier is changed here.
-- Company Manager remains optional and is intentionally not persisted until
-- the Platform Company -> Branch relationship moves to Supabase.

CREATE OR REPLACE FUNCTION public.has_manage_employee_of_month_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(_user_id)
      OR public.has_role(_user_id, 'branch_manager'::public.app_role)
      OR (
        public.has_role(_user_id, 'assistant_manager'::public.app_role)
        AND EXISTS (
          SELECT 1
          FROM public.user_task_permissions permission
          WHERE permission.user_id = _user_id
            AND permission.can_manage_employee_of_month = true
        )
      );
$$;

CREATE OR REPLACE FUNCTION public.can_view_schedule_department(
  _user_id uuid,
  _department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(_user_id)
    OR public.has_role(_user_id, 'branch_manager'::public.app_role)
    OR (
      public.has_role(_user_id, 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.user_task_permissions permission
        WHERE permission.user_id = _user_id
          AND (
            permission.can_manage_schedule
            OR permission.can_create_schedule
            OR permission.can_approve_schedule
            OR permission.can_publish_schedule
          )
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles profile
      WHERE profile.id = _user_id
        AND profile.department_id = _department_id
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_department_directory(
  _user_id uuid,
  _department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(_user_id)
    OR public.has_role(_user_id, 'branch_manager'::public.app_role)
    OR (
      public.has_role(_user_id, 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.user_task_permissions permission
        WHERE permission.user_id = _user_id
          AND permission.can_manage_departments = true
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles profile
      WHERE profile.id = _user_id
        AND profile.department_id = _department_id
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_profile(
  _user_id uuid,
  _profile_id uuid,
  _department_id uuid,
  _branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _profile_id = _user_id
    OR public.is_platform_owner(_user_id)
    OR public.has_role(_user_id, 'branch_manager'::public.app_role)
    OR (
      public.has_role(_user_id, 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.user_task_permissions permission
        WHERE permission.user_id = _user_id
          AND (
            permission.can_view_all_employees
            OR permission.can_view_employee_details
            OR permission.can_add_employee
            OR permission.can_edit_employee
            OR permission.can_delete_employee
            OR permission.can_manage_employee_of_month
          )
      )
    )
    OR (
      public.has_role(_user_id, 'department_manager'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.profiles caller
        WHERE caller.id = _user_id
          AND caller.department_id = _department_id
          AND caller.branch_id = _branch_id
      )
    );
$$;

-- The prior SELECT policy exposed every EOM history record to every
-- authenticated user. Current-month display remains available to branch
-- users, while the management history is limited to a scoped manager.
DROP POLICY IF EXISTS authorization_eom_history_scope ON public.employee_of_month;
CREATE POLICY authorization_eom_history_scope
  ON public.employee_of_month AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_manage_employee_of_month_perm(auth.uid())
    OR (
      year = EXTRACT(YEAR FROM CURRENT_DATE)::integer
      AND month = EXTRACT(MONTH FROM CURRENT_DATE)::integer
    )
  );

-- Direct browser queries cannot bypass department scope. This policy narrows
-- existing permissive schedule policies; it does not replace workflow rules.
DROP POLICY IF EXISTS authorization_schedule_department_scope ON public.schedules;
CREATE POLICY authorization_schedule_department_scope
  ON public.schedules AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.can_view_schedule_department(auth.uid(), department_id)
    AND (
      NOT EXISTS (
        SELECT 1
        FROM public.user_roles role
        WHERE role.user_id = auth.uid()
          AND role.role = 'employee'::public.app_role
      )
      OR (status = 'approved'::public.schedule_status AND published_at IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS authorization_schedule_shift_department_scope ON public.schedule_shifts;
CREATE POLICY authorization_schedule_shift_department_scope
  ON public.schedule_shifts AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.schedules schedule
      WHERE schedule.id = schedule_shifts.schedule_id
        AND public.can_view_schedule_department(auth.uid(), schedule.department_id)
        AND (
          NOT EXISTS (
            SELECT 1
            FROM public.user_roles role
            WHERE role.user_id = auth.uid()
              AND role.role = 'employee'::public.app_role
          )
          OR (schedule.status = 'approved'::public.schedule_status AND schedule.published_at IS NOT NULL)
        )
    )
  );

-- Department names/headcounts and employee profiles are sensitive directory
-- data. Department Managers are limited to their department; employees only
-- receive their own profile and current-month EOM display.
DROP POLICY IF EXISTS authorization_department_directory_scope ON public.departments;
CREATE POLICY authorization_department_directory_scope
  ON public.departments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.can_view_department_directory(auth.uid(), id));

DROP POLICY IF EXISTS authorization_profile_directory_scope ON public.profiles;
CREATE POLICY authorization_profile_directory_scope
  ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.can_view_profile(auth.uid(), id, department_id, branch_id));
