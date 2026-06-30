-- Restore branch-manager authority within their own branch while preserving branch isolation.

-- Helper: branch managers are full managers for their own branch; assistant managers require granular permissions.
CREATE OR REPLACE FUNCTION public.has_view_all_employees_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR public.has_role(_user_id,'branch_manager')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = _user_id AND can_view_all_employees = true);
$$;

CREATE OR REPLACE FUNCTION public.has_view_employee_details_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR public.has_role(_user_id,'branch_manager')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = _user_id AND can_view_employee_details = true);
$$;

CREATE OR REPLACE FUNCTION public.has_break_manage_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR public.has_role(_user_id,'branch_manager')
    OR EXISTS (SELECT 1 FROM public.user_task_permissions
               WHERE user_id = _user_id AND can_manage_breaks = true);
$$;

CREATE OR REPLACE FUNCTION public.has_task_create_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR public.has_role(_user_id,'branch_manager')
    OR ((public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND (can_manage_tasks OR can_create_tasks)));
$$;

CREATE OR REPLACE FUNCTION public.has_task_edit_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR public.has_role(_user_id,'branch_manager')
    OR ((public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND (can_manage_tasks OR can_edit_tasks)));
$$;

CREATE OR REPLACE FUNCTION public.has_task_delete_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR public.has_role(_user_id,'branch_manager')
    OR ((public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND (can_manage_tasks OR can_delete_tasks)));
$$;

CREATE OR REPLACE FUNCTION public.has_task_approve_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR public.has_role(_user_id,'branch_manager')
    OR ((public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND (can_manage_tasks OR can_approve_tasks)));
$$;

CREATE OR REPLACE FUNCTION public.has_task_close_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR public.has_role(_user_id,'branch_manager')
    OR ((public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND (can_manage_tasks OR can_approve_tasks)));
$$;

CREATE OR REPLACE FUNCTION public.has_task_management_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR public.has_role(_user_id,'branch_manager')
    OR (
      public.has_role(_user_id,'assistant_manager')
      AND EXISTS (SELECT 1 FROM public.user_task_permissions
                  WHERE user_id = _user_id AND can_manage_tasks = true)
    );
$$;

CREATE OR REPLACE FUNCTION public.has_schedule_create_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR public.has_role(_user_id,'branch_manager')
    OR public.has_role(_user_id,'department_manager')
    OR (public.has_role(_user_id,'assistant_manager')
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND can_create_schedule = true));
$$;

CREATE OR REPLACE FUNCTION public.has_schedule_manage_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR public.has_role(_user_id,'branch_manager')
    OR EXISTS (SELECT 1 FROM public.user_task_permissions
               WHERE user_id = _user_id AND can_manage_schedule = true);
$$;

CREATE OR REPLACE FUNCTION public.has_schedule_approve_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR public.has_role(_user_id,'branch_manager')
    OR (public.has_role(_user_id,'assistant_manager')
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND can_approve_schedule = true));
$$;

CREATE OR REPLACE FUNCTION public.has_schedule_publish_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR public.has_role(_user_id,'branch_manager')
    OR (public.has_role(_user_id,'assistant_manager')
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND can_publish_schedule = true));
$$;

CREATE OR REPLACE FUNCTION public.has_manage_employee_of_month_perm(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_uid, 'main_admin')
      OR public.has_role(_uid, 'branch_manager')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                  WHERE user_id = _uid AND can_manage_employee_of_month = true);
$$;

CREATE OR REPLACE FUNCTION public.has_send_messages_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR public.has_role(_user_id,'branch_manager')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = _user_id
                   AND (can_send_messages OR can_manage_communications));
$$;

CREATE OR REPLACE FUNCTION public.has_send_announcements_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR public.has_role(_user_id,'branch_manager')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = _user_id
                   AND (can_send_announcements OR can_manage_communications));
$$;

CREATE OR REPLACE FUNCTION public.has_manage_communications_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR public.has_role(_user_id,'branch_manager')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = _user_id AND can_manage_communications);
$$;

CREATE OR REPLACE FUNCTION public.has_delete_communications_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR public.has_role(_user_id,'branch_manager')
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = _user_id
          AND (can_delete_communications OR can_manage_communications)
      );
$$;

-- Keep existing rows aligned with the user's current branch; remove stale static defaults.
ALTER TABLE public.user_task_permissions ALTER COLUMN branch_id DROP DEFAULT;
UPDATE public.user_task_permissions u
SET branch_id = p.branch_id
FROM public.profiles p
WHERE p.id = u.user_id
  AND u.branch_id IS DISTINCT FROM p.branch_id;

-- Departments: allow branch managers to manage departments in their own branch; assistants only with explicit permission.
DROP POLICY IF EXISTS "Admins can insert departments" ON public.departments;
DROP POLICY IF EXISTS "Admins can update departments" ON public.departments;
DROP POLICY IF EXISTS "Admins can delete departments" ON public.departments;

CREATE POLICY "Branch admins can insert departments"
ON public.departments
FOR INSERT
TO authenticated
WITH CHECK (
  branch_id IS NOT NULL
  AND public.current_active_branch() IS NOT NULL
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
          AND p.can_manage_departments = true
      )
    )
  )
);

CREATE POLICY "Branch admins can update departments"
ON public.departments
FOR UPDATE
TO authenticated
USING (
  branch_id IS NOT NULL
  AND public.current_active_branch() IS NOT NULL
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
          AND p.can_manage_departments = true
      )
    )
  )
)
WITH CHECK (
  branch_id IS NOT NULL
  AND public.current_active_branch() IS NOT NULL
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
          AND p.can_manage_departments = true
      )
    )
  )
);

CREATE POLICY "Branch admins can delete departments"
ON public.departments
FOR DELETE
TO authenticated
USING (
  branch_id IS NOT NULL
  AND public.current_active_branch() IS NOT NULL
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
          AND p.can_manage_departments = true
      )
    )
  )
);

-- User task permissions: branch managers may grant granular permissions only to assistant managers in their own branch.
DROP POLICY IF EXISTS "Users view own task permissions" ON public.user_task_permissions;
DROP POLICY IF EXISTS "Main admin manages task permissions" ON public.user_task_permissions;

CREATE POLICY "Users and branch managers view task permissions"
ON public.user_task_permissions
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
  OR (
    public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    AND branch_id = public.current_active_branch()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = user_task_permissions.user_id
        AND ur.role = 'assistant_manager'::public.app_role
    )
  )
);

CREATE POLICY "Main admin manages task permissions"
ON public.user_task_permissions
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'main_admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'main_admin'::public.app_role));

CREATE POLICY "Branch managers insert assistant permissions"
ON public.user_task_permissions
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'branch_manager'::public.app_role)
  AND branch_id = public.current_active_branch()
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.profiles target
    WHERE target.id = user_task_permissions.user_id
      AND target.branch_id = public.current_active_branch()
  )
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = user_task_permissions.user_id
      AND ur.role = 'assistant_manager'::public.app_role
  )
);

CREATE POLICY "Branch managers update assistant permissions"
ON public.user_task_permissions
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'branch_manager'::public.app_role)
  AND branch_id = public.current_active_branch()
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = user_task_permissions.user_id
      AND ur.role = 'assistant_manager'::public.app_role
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'branch_manager'::public.app_role)
  AND branch_id = public.current_active_branch()
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.profiles target
    WHERE target.id = user_task_permissions.user_id
      AND target.branch_id = public.current_active_branch()
  )
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = user_task_permissions.user_id
      AND ur.role = 'assistant_manager'::public.app_role
  )
);

-- Department manager RPC: same-branch branch managers are authorized, assistants only with department-management permission.
CREATE OR REPLACE FUNCTION public.set_department_manager(_dept_id uuid, _new_manager_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_manager_id uuid;
  _dept_branch_id uuid;
  _manager_branch_id uuid;
  _manager_active boolean;
  _active_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid()
          AND p.can_manage_departments = true
      )
    )
  ) THEN
    RAISE EXCEPTION 'אין הרשאה לניהול מחלקות';
  END IF;

  _active_branch_id := public.current_active_branch();
  IF _active_branch_id IS NULL THEN
    RAISE EXCEPTION 'יש לבחור סניף פעיל לפני שינוי מחלקה';
  END IF;

  SELECT manager_id, branch_id
    INTO _old_manager_id, _dept_branch_id
  FROM public.departments
  WHERE id = _dept_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'מחלקה לא נמצאה';
  END IF;

  IF _dept_branch_id IS DISTINCT FROM _active_branch_id THEN
    RAISE EXCEPTION 'מחלקה לא נמצאה בסניף הפעיל';
  END IF;

  IF _new_manager_id IS NOT NULL THEN
    SELECT branch_id, COALESCE(is_active, true)
      INTO _manager_branch_id, _manager_active
    FROM public.profiles
    WHERE id = _new_manager_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'מנהל מחלקה לא נמצא';
    END IF;

    IF _manager_branch_id IS DISTINCT FROM _dept_branch_id THEN
      RAISE EXCEPTION 'ניתן לשייך מנהל רק מאותו סניף';
    END IF;

    IF _manager_active IS NOT TRUE THEN
      RAISE EXCEPTION 'לא ניתן לשייך עובד לא פעיל כמנהל מחלקה';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.departments
      WHERE manager_id = _new_manager_id
        AND id <> _dept_id
        AND branch_id = _dept_branch_id
    ) THEN
      RAISE EXCEPTION 'העובד כבר משמש כאחראי של מחלקה אחרת';
    END IF;
  END IF;

  IF _old_manager_id IS NOT DISTINCT FROM _new_manager_id THEN
    RETURN;
  END IF;

  UPDATE public.departments
  SET manager_id = _new_manager_id
  WHERE id = _dept_id
    AND branch_id = _active_branch_id;

  IF _new_manager_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_new_manager_id, 'department_manager'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  IF _old_manager_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.departments
       WHERE manager_id = _old_manager_id
         AND id <> _dept_id
     ) THEN
    DELETE FROM public.user_roles
    WHERE user_id = _old_manager_id
      AND role = 'department_manager'::public.app_role;
  END IF;
END;
$$;

-- Employee lifecycle RPCs: branch managers operate only in their branch; assistants need explicit permissions.
CREATE OR REPLACE FUNCTION public.archive_employee(_user_id uuid, _reason text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  _active_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'לא ניתן למחוק את החשבון של עצמך'; END IF;
  IF public.is_system_admin(_user_id) THEN RAISE EXCEPTION 'לא ניתן למחוק מנהל מערכת ראשי'; END IF;

  _active_branch_id := public.current_active_branch();
  IF _active_branch_id IS NULL THEN
    RAISE EXCEPTION 'יש לבחור סניף פעיל';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
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

  SELECT p2.id, p2.id_number, p2.branch_id
    INTO p
    FROM public.profiles p2
   WHERE p2.id = _user_id
     AND p2.branch_id = _active_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'עובד לא נמצא בסניף הפעיל'; END IF;

  IF public.has_role(_user_id, 'main_admin'::public.app_role)
     OR public.has_role(_user_id, 'branch_manager'::public.app_role) THEN
    IF NOT public.has_role(auth.uid(), 'main_admin'::public.app_role) THEN
      RAISE EXCEPTION 'רק מנהל ראשי יכול למחוק מנהל';
    END IF;
  END IF;

  DELETE FROM public.employee_archive
   WHERE branch_id = _active_branch_id
     AND (original_id = _user_id OR (p.id_number IS NOT NULL AND id_number = p.id_number));

  UPDATE public.departments SET manager_id = NULL
   WHERE manager_id = _user_id
     AND branch_id = _active_branch_id;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id AND branch_id = _active_branch_id;

  RETURN _user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_employee_active(_user_id uuid, _active boolean, _note text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  _active_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF _user_id = auth.uid() AND _active = false THEN RAISE EXCEPTION 'לא ניתן להשבית את החשבון של עצמך'; END IF;
  IF public.is_system_admin(_user_id) AND _active = false THEN RAISE EXCEPTION 'לא ניתן להשבית מנהל מערכת ראשי'; END IF;

  _active_branch_id := public.current_active_branch();
  IF _active_branch_id IS NULL THEN RAISE EXCEPTION 'יש לבחור סניף פעיל'; END IF;

  IF NOT (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.user_task_permissions p0
        WHERE p0.user_id = auth.uid()
          AND (p0.can_edit_employee = true OR p0.can_delete_employee = true)
      )
    )
  ) THEN
    RAISE EXCEPTION 'אין הרשאה לעדכון סטטוס עובד';
  END IF;

  SELECT id, branch_id INTO p
  FROM public.profiles
  WHERE id = _user_id
    AND branch_id = _active_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'עובד לא נמצא בסניף הפעיל'; END IF;

  UPDATE public.profiles
     SET is_active = _active,
         deactivated_at = CASE WHEN _active THEN NULL ELSE now() END
   WHERE id = _user_id
     AND branch_id = _active_branch_id;

  INSERT INTO public.profile_status_log (profile_id, actor_id, is_active, note, branch_id)
  VALUES (_user_id, auth.uid(), _active, _note, _active_branch_id);
END;
$$;