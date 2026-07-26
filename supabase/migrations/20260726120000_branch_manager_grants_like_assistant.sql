-- Branch manager: no automatic action permissions.
-- Same model as assistant_manager — grants live in user_task_permissions.
-- Platform owners (main_admin / system_admin) remain full authority.

-- 1) Leave permissions: BM requires explicit grants
CREATE OR REPLACE FUNCTION public.has_leave_perm(_user_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN _user_id IS NULL THEN false

      WHEN public.has_role(_user_id, 'system_admin'::public.app_role)
        OR public.has_role(_user_id, 'main_admin'::public.app_role)
      THEN true

      WHEN _perm = 'balance' THEN EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = _user_id
          AND p.can_edit_leave_balance = true
          AND (
            public.has_role(_user_id, 'branch_manager'::public.app_role)
            OR public.has_role(_user_id, 'assistant_manager'::public.app_role)
          )
      )

      -- View / approve / reject: BM and assistant via grants only
      WHEN public.has_role(_user_id, 'branch_manager'::public.app_role)
        OR public.has_role(_user_id, 'assistant_manager'::public.app_role)
      THEN EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = _user_id
          AND (
            (_perm = 'view' AND (p.can_view_leave OR p.can_approve_leave OR p.can_reject_leave OR p.can_edit_leave_balance))
            OR (_perm = 'approve' AND p.can_approve_leave)
            OR (_perm = 'reject' AND p.can_reject_leave)
          )
      )

      ELSE false
    END;
$$;

-- 2) Break manage: BM via grant (or platform owner)
CREATE OR REPLACE FUNCTION public.has_break_manage_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'system_admin'::public.app_role)
    OR public.has_role(_user_id, 'main_admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_task_permissions p
      WHERE p.user_id = _user_id
        AND p.can_manage_breaks = true
        AND (
          public.has_role(_user_id, 'branch_manager'::public.app_role)
          OR public.has_role(_user_id, 'assistant_manager'::public.app_role)
        )
    );
$$;

-- 3) Sync: seed BM with the same read-only baseline as assistant
CREATE OR REPLACE FUNCTION public.sync_user_task_permissions(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _roles public.app_role[];
  _branch_id uuid;
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(role ORDER BY role), ARRAY[]::public.app_role[])
    INTO _roles
  FROM public.user_roles
  WHERE user_id = _user_id;

  SELECT branch_id INTO _branch_id FROM public.profiles WHERE id = _user_id;

  DELETE FROM public.user_task_permissions WHERE user_id = _user_id;

  -- Platform owners: no granular row (full access by role)
  IF _roles && ARRAY[
    'main_admin'::public.app_role,
    'system_admin'::public.app_role
  ] THEN
    RETURN;
  END IF;

  IF 'department_manager'::public.app_role = ANY(_roles)
     AND NOT (
       'branch_manager'::public.app_role = ANY(_roles)
       OR 'assistant_manager'::public.app_role = ANY(_roles)
     )
  THEN
    RETURN;
  END IF;

  -- Branch manager + assistant: read-only baseline; actions granted by platform owner
  IF 'branch_manager'::public.app_role = ANY(_roles)
     OR 'assistant_manager'::public.app_role = ANY(_roles)
  THEN
    INSERT INTO public.user_task_permissions (
      user_id,
      branch_id,
      can_view_dashboard,
      can_view_all_employees,
      can_view_employee_details,
      can_view_schedule,
      can_view_tasks,
      updated_at
    ) VALUES (
      _user_id,
      _branch_id,
      true,
      true,
      true,
      true,
      true,
      now()
    );
  END IF;
END;
$$;

-- 4) Seed existing branch managers that have no permission row
INSERT INTO public.user_task_permissions (
  user_id,
  branch_id,
  can_view_dashboard,
  can_view_all_employees,
  can_view_employee_details,
  can_view_schedule,
  can_view_tasks,
  updated_at
)
SELECT
  ur.user_id,
  p.branch_id,
  true,
  true,
  true,
  true,
  true,
  now()
FROM public.user_roles ur
JOIN public.profiles p ON p.id = ur.user_id
WHERE ur.role = 'branch_manager'::public.app_role
  AND NOT EXISTS (
    SELECT 1 FROM public.user_task_permissions utp WHERE utp.user_id = ur.user_id
  )
ON CONFLICT (user_id) DO NOTHING;

-- Also update morning-board helper: BM no longer auto-manages
CREATE OR REPLACE FUNCTION public.has_manage_morning_board_perm(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(_uid, 'main_admin')
      OR public.has_role(_uid, 'system_admin')
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = _uid AND can_manage_morning_board = true
      );
$$;

NOTIFY pgrst, 'reload schema';
