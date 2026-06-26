
ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS can_approve_tasks boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.has_task_approve_perm(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR ((public.has_role(_user_id,'branch_manager') OR public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND (can_manage_tasks OR can_approve_tasks)));
$$;
REVOKE EXECUTE ON FUNCTION public.has_task_approve_perm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_task_approve_perm(uuid) TO authenticated;

-- Routing: can _approver approve _task ?
CREATE OR REPLACE FUNCTION public.can_approve_task(_task_id uuid, _approver_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t_created_by uuid;
  t_dept uuid;
  creator_is_only_deptmgr boolean;
BEGIN
  SELECT created_by, department_id INTO t_created_by, t_dept
    FROM public.tasks WHERE id = _task_id;
  IF t_created_by IS NULL THEN RETURN false; END IF;
  -- Creator can never approve their own task
  IF t_created_by = _approver_id THEN RETURN false; END IF;

  creator_is_only_deptmgr := public.has_role(t_created_by,'department_manager')
    AND NOT public.has_role(t_created_by,'main_admin')
    AND NOT public.has_role(t_created_by,'branch_manager')
    AND NOT public.has_role(t_created_by,'assistant_manager');

  IF creator_is_only_deptmgr THEN
    RETURN public.has_task_approve_perm(_approver_id);
  ELSE
    -- Approver must be a department_manager of the task's department
    RETURN public.has_role(_approver_id,'department_manager')
       AND EXISTS (SELECT 1 FROM public.profiles
                   WHERE id = _approver_id AND department_id = t_dept);
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.can_approve_task(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_approve_task(uuid, uuid) TO authenticated;

-- Update guard to enforce approval routing on status -> completed
CREATE OR REPLACE FUNCTION public.tasks_guard_assignee_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_priv boolean;
  in_dept boolean;
  is_approver boolean;
BEGIN
  is_priv := public.has_task_edit_perm(auth.uid())
    OR EXISTS (SELECT 1 FROM public.departments WHERE id = OLD.department_id AND manager_id = auth.uid());
  in_dept := EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND department_id = OLD.department_id);
  is_approver := public.can_approve_task(OLD.id, auth.uid());

  IF NOT is_priv THEN
    IF NOT in_dept AND NOT is_approver THEN
      RAISE EXCEPTION 'אין הרשאה לעדכן משימה זו';
    END IF;

    IF NEW.title IS DISTINCT FROM OLD.title
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.department_id IS DISTINCT FROM OLD.department_id
      OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
      OR NEW.due_at IS DISTINCT FROM OLD.due_at
      OR NEW.priority IS DISTINCT FROM OLD.priority
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.recurrence_id IS DISTINCT FROM OLD.recurrence_id
    THEN
      RAISE EXCEPTION 'אין הרשאה לערוך שדות אלה במשימה';
    END IF;

    IF NEW.status = 'completed' AND OLD.status <> 'completed' AND NOT is_approver THEN
      RAISE EXCEPTION 'רק המאשר המורשה יכול לאשר השלמת משימה';
    END IF;

    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'משימה הושלמה ואושרה — לא ניתן לעדכן';
    END IF;
  ELSE
    -- Privileged editors still cannot approve their own tasks
    IF NEW.status = 'completed' AND OLD.status <> 'completed' AND NOT is_approver THEN
      RAISE EXCEPTION 'יוצר המשימה אינו יכול לאשר אותה בעצמו';
    END IF;
  END IF;

  IF NEW.status = 'pending_approval' AND OLD.status <> 'pending_approval' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.completed_by := COALESCE(NEW.completed_by, auth.uid());
  END IF;

  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.approved_at  := now();
    NEW.approved_by  := auth.uid();
  END IF;

  IF NEW.status NOT IN ('completed','pending_approval') THEN
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
    NEW.approved_at  := NULL;
    NEW.approved_by  := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;
