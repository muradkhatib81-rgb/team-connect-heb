-- Complete Branch Manager restoration after multi-branch scoping.
-- Branch managers regain full management authority inside their own branch only.

-- Ensure branch managers can view employee contact details, but only in the active branch.
CREATE OR REPLACE FUNCTION public.get_profile_contact(_id uuid)
RETURNS TABLE(id_number text, phone text, must_change_password boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id_number, p.phone, p.must_change_password
  FROM public.profiles p
  WHERE p.id = _id
    AND (
      auth.uid() = _id
      OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
      OR public.is_system_admin(auth.uid())
      OR public.has_view_employee_details_perm(auth.uid())
    )
    AND (
      public.current_active_branch() IS NULL
      OR p.branch_id = public.current_active_branch()
      OR p.id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.list_profiles_contact()
RETURNS TABLE(id uuid, id_number text, phone text, must_change_password boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.id_number, p.phone, p.must_change_password
  FROM public.profiles p
  WHERE (
      public.has_role(auth.uid(), 'main_admin'::public.app_role)
      OR public.is_system_admin(auth.uid())
      OR public.has_view_employee_details_perm(auth.uid())
    )
    AND (
      public.current_active_branch() IS NULL
      OR p.branch_id = public.current_active_branch()
    );
$$;

REVOKE EXECUTE ON FUNCTION public.get_profile_contact(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_profiles_contact() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_contact(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_profiles_contact() TO authenticated, service_role;

-- User-role helpers scoped through the target user's profile branch.
CREATE OR REPLACE FUNCTION public.can_manage_user_role_in_active_branch(_target_user_id uuid, _target_role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles target
    WHERE target.id = _target_user_id
      AND (
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

GRANT EXECUTE ON FUNCTION public.can_manage_user_role_in_active_branch(uuid, public.app_role) TO authenticated, service_role;

-- Replace broad user_roles policies with branch-aware variants.
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Main admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Branch admins can view scoped roles" ON public.user_roles;
DROP POLICY IF EXISTS "Branch admins can insert scoped roles" ON public.user_roles;
DROP POLICY IF EXISTS "Branch admins can delete scoped roles" ON public.user_roles;
DROP POLICY IF EXISTS "Branch admins can update scoped roles" ON public.user_roles;

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
      FROM public.profiles target
      WHERE target.id = user_roles.user_id
        AND target.branch_id = public.current_active_branch()
    )
  )
);

CREATE POLICY "Branch admins can insert scoped roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_user_role_in_active_branch(user_id, role));

CREATE POLICY "Branch admins can delete scoped roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.can_manage_user_role_in_active_branch(user_id, role));

CREATE POLICY "Branch admins can update scoped roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.can_manage_user_role_in_active_branch(user_id, role))
WITH CHECK (public.can_manage_user_role_in_active_branch(user_id, role));

-- Keep employee-management RLS branch-aware for direct profile updates.
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "Branch admins can update scoped profiles" ON public.profiles;
DROP POLICY IF EXISTS "Branch admins can insert scoped profiles" ON public.profiles;
DROP POLICY IF EXISTS "Branch admins can delete scoped profiles" ON public.profiles;

CREATE POLICY "Branch admins can update scoped profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  public.current_active_branch() IS NOT NULL
  AND branch_id = public.current_active_branch()
  AND (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid()
          AND p.can_edit_employee = true
      )
    )
  )
)
WITH CHECK (
  public.current_active_branch() IS NOT NULL
  AND branch_id = public.current_active_branch()
  AND (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid()
          AND p.can_edit_employee = true
      )
    )
  )
);

CREATE POLICY "Branch admins can insert scoped profiles"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_active_branch() IS NOT NULL
  AND branch_id = public.current_active_branch()
  AND (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid()
          AND p.can_add_employee = true
      )
    )
  )
);

CREATE POLICY "Branch admins can delete scoped profiles"
ON public.profiles
FOR DELETE
TO authenticated
USING (
  public.current_active_branch() IS NOT NULL
  AND branch_id = public.current_active_branch()
  AND (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid()
          AND p.can_delete_employee = true
      )
    )
  )
);

-- Department managers are assigned by set_department_manager; the branch check above
-- allows the RPC to manage only same-branch department_manager rows.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
