-- Permission/user managers need the same branch-directory visibility required
-- by the screens they manage. Existing restrictive branch policies still apply.

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
      AND (
        EXISTS (
          SELECT 1
          FROM public.user_task_permissions permission
          WHERE permission.user_id = _user_id
            AND (
              permission.can_manage_departments
              OR permission.can_manage_permissions
              OR permission.can_manage_users
            )
        )
        OR public.has_schedule_workflow_perm(_user_id)
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.profile_scope_internal(_user_id) profile
      WHERE profile.department_id = _department_id
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
      AND (
        EXISTS (
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
              OR permission.can_manage_permissions
              OR permission.can_manage_users
            )
        )
        OR public.has_schedule_workflow_perm(_user_id)
      )
    )
    OR (
      public.has_role(_user_id, 'department_manager'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.profile_scope_internal(_user_id) caller
        WHERE caller.department_id = _department_id
          AND caller.branch_id = _branch_id
      )
    );
$$;

NOTIFY pgrst, 'reload schema';
