-- Platform owners (system_admin + main_admin) get full task/comms delete+manage
-- authority via is_platform_owner(). Also breaks tasks ↔ task_assignees /
-- task_departments RLS recursion that hits system_admin (no main_admin short-circuit).

-- ========== Task permission helpers ==========
CREATE OR REPLACE FUNCTION public.has_task_create_perm(_user_id uuid)
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
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = _user_id
          AND (can_manage_tasks = true OR can_create_tasks = true)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.has_task_edit_perm(_user_id uuid)
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
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = _user_id
          AND (can_manage_tasks = true OR can_edit_tasks = true)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.has_task_delete_perm(_user_id uuid)
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
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = _user_id
          AND (can_manage_tasks = true OR can_delete_tasks = true)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.has_task_approve_perm(_user_id uuid)
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
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = _user_id
          AND (can_manage_tasks = true OR can_approve_tasks = true)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.has_task_close_perm(_user_id uuid)
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
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = _user_id
          AND (can_manage_tasks = true OR can_approve_tasks = true)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.has_task_management_perm(_user_id uuid)
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
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = _user_id AND can_manage_tasks = true
      )
    );
$$;

-- ========== Break RLS recursion helpers (SECURITY DEFINER bypasses RLS) ==========
CREATE OR REPLACE FUNCTION public.user_is_task_assignee(_task_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_assignees
    WHERE task_id = _task_id AND user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.user_shares_task_department(_task_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.task_departments td
    JOIN public.profiles p ON p.id = _user_id
    WHERE td.task_id = _task_id
      AND td.department_id = p.department_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.task_departments td
    JOIN public.departments d ON d.id = td.department_id
    WHERE td.task_id = _task_id
      AND d.manager_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_task(_task_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = _task_id
      AND (
        public.is_platform_owner(_user_id)
        OR public.has_task_edit_perm(_user_id)
        OR public.is_admin(_user_id)
        OR t.created_by = _user_id
        OR t.assignee_id = _user_id
        OR t.target_scope = 'all_departments'::public.task_target_scope
        OR public.user_is_task_assignee(t.id, _user_id)
        OR t.department_id IN (SELECT d.id FROM public.departments d WHERE d.manager_id = _user_id)
        OR t.department_id = (SELECT p.department_id FROM public.profiles p WHERE p.id = _user_id)
        OR public.user_shares_task_department(t.id, _user_id)
      )
  );
$$;

-- Task visibility: platform owner first; use definer helpers (no recursive EXISTS)
DROP POLICY IF EXISTS "Task visibility" ON public.tasks;
CREATE POLICY "Task visibility" ON public.tasks
  FOR SELECT TO authenticated USING (
    public.is_platform_owner(auth.uid())
    OR public.has_task_edit_perm(auth.uid())
    OR public.is_admin(auth.uid())
    OR created_by = auth.uid()
    OR assignee_id = auth.uid()
    OR target_scope = 'all_departments'
    OR public.user_is_task_assignee(id, auth.uid())
    OR department_id IN (SELECT d.id FROM public.departments d WHERE d.manager_id = auth.uid())
    OR department_id = (SELECT p.department_id FROM public.profiles p WHERE p.id = auth.uid())
    OR public.user_shares_task_department(id, auth.uid())
  );

-- Child tables: avoid SELECT-from-tasks under RLS (recursion)
DROP POLICY IF EXISTS "task_assignees_select" ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_select ON public.task_assignees;
CREATE POLICY task_assignees_select ON public.task_assignees
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_platform_owner(auth.uid())
    OR public.has_task_edit_perm(auth.uid())
    OR public.can_view_task(task_id, auth.uid())
  );

DROP POLICY IF EXISTS "task_departments_select" ON public.task_departments;
DROP POLICY IF EXISTS task_departments_select ON public.task_departments;
CREATE POLICY task_departments_select ON public.task_departments
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.has_task_edit_perm(auth.uid())
    OR public.can_view_task(task_id, auth.uid())
  );

-- ========== Communications (from prior migration) ==========
CREATE OR REPLACE FUNCTION public.has_manage_communications_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(_user_id)
      OR public.has_role(_user_id, 'branch_manager'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = _user_id AND can_manage_communications = true
      );
$$;

CREATE OR REPLACE FUNCTION public.has_delete_communications_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(_user_id)
      OR public.has_role(_user_id, 'branch_manager'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.user_task_permissions
        WHERE user_id = _user_id
          AND (can_delete_communications = true OR can_manage_communications = true)
      );
$$;

CREATE OR REPLACE FUNCTION public.purge_message_global(_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_sender uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT title, sender_id INTO v_title, v_sender
  FROM public.messages
  WHERE id = _message_id;

  IF v_title IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    v_sender = auth.uid()
    OR public.is_platform_owner(auth.uid())
    OR public.has_delete_communications_perm(auth.uid())
  ) THEN
    RAISE EXCEPTION 'אין הרשאה למחיקה';
  END IF;

  DELETE FROM public.schedule_notifications
  WHERE message LIKE ('הודעה עודכנה: ' || v_title || '%');

  DELETE FROM public.messages WHERE id = _message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_announcement_global(_ann_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_sender uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT title, sender_id INTO v_title, v_sender
  FROM public.announcements
  WHERE id = _ann_id;

  IF v_title IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    v_sender = auth.uid()
    OR public.is_platform_owner(auth.uid())
    OR public.has_delete_communications_perm(auth.uid())
  ) THEN
    RAISE EXCEPTION 'אין הרשאה למחיקה';
  END IF;

  DELETE FROM public.schedule_notifications
  WHERE message LIKE ('הכרזה עודכנה: ' || v_title || '%');

  DELETE FROM public.announcements WHERE id = _ann_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_task_create_perm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_task_edit_perm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_task_delete_perm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_task_approve_perm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_task_close_perm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_task_management_perm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_is_task_assignee(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_shares_task_department(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_task(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_manage_communications_perm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_delete_communications_perm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_message_global(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_announcement_global(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
