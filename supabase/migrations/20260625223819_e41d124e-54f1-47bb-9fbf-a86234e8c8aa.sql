
-- Phase 2.1 fixes for Tasks

-- 1) Extend task_status with pending_approval
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'pending_approval' BEFORE 'completed';

-- 2) Add completion / approval tracking columns
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employee_note text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_note text,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

-- 3) Extend user_task_permissions with granular flags
ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS can_create_tasks    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit_tasks      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_delete_tasks    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_create_schedule boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_approve_schedule boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_approve_leave   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_breaks     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_send_messages   boolean NOT NULL DEFAULT false;

-- Mirror legacy can_manage_tasks into the new flags for existing grants
UPDATE public.user_task_permissions
SET can_create_tasks = true,
    can_edit_tasks   = true,
    can_delete_tasks = true
WHERE can_manage_tasks = true;

-- 4) Permission helper functions per action
CREATE OR REPLACE FUNCTION public.has_task_create_perm(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR ((public.has_role(_user_id,'branch_manager') OR public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND (can_manage_tasks OR can_create_tasks)));
$$;

CREATE OR REPLACE FUNCTION public.has_task_edit_perm(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR ((public.has_role(_user_id,'branch_manager') OR public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND (can_manage_tasks OR can_edit_tasks)));
$$;

CREATE OR REPLACE FUNCTION public.has_task_delete_perm(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR ((public.has_role(_user_id,'branch_manager') OR public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND (can_manage_tasks OR can_delete_tasks)));
$$;

REVOKE EXECUTE ON FUNCTION public.has_task_create_perm(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_task_edit_perm(uuid)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_task_delete_perm(uuid) FROM PUBLIC, anon, authenticated;

-- 5) Refresh RLS policies on tasks: dept-wide read/update, granular admin perms
DROP POLICY IF EXISTS "Task insert"     ON public.tasks;
DROP POLICY IF EXISTS "Task update"     ON public.tasks;
DROP POLICY IF EXISTS "Task delete"     ON public.tasks;
DROP POLICY IF EXISTS "Task visibility" ON public.tasks;

CREATE POLICY "Task visibility" ON public.tasks
FOR SELECT TO authenticated USING (
  public.has_task_edit_perm(auth.uid())
  OR public.is_admin(auth.uid())
  OR created_by = auth.uid()
  OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
  OR department_id = (SELECT department_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Task insert" ON public.tasks
FOR INSERT TO authenticated WITH CHECK (
  public.has_task_create_perm(auth.uid())
  OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
);

CREATE POLICY "Task update" ON public.tasks
FOR UPDATE TO authenticated
USING (
  public.has_task_edit_perm(auth.uid())
  OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
  OR department_id = (SELECT department_id FROM public.profiles WHERE id = auth.uid())
)
WITH CHECK (
  public.has_task_edit_perm(auth.uid())
  OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
  OR department_id = (SELECT department_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Task delete" ON public.tasks
FOR DELETE TO authenticated USING (
  public.has_task_delete_perm(auth.uid())
);

-- 6) Replace guard trigger fn with approval workflow
CREATE OR REPLACE FUNCTION public.tasks_guard_assignee_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_priv boolean;
  in_dept boolean;
BEGIN
  is_priv := public.has_task_edit_perm(auth.uid())
    OR EXISTS (SELECT 1 FROM public.departments WHERE id = OLD.department_id AND manager_id = auth.uid());

  in_dept := EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND department_id = OLD.department_id);

  IF NOT is_priv THEN
    -- Plain dept employee: only status (limited), notes, employee_note
    IF NOT in_dept THEN
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
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.rejection_note IS DISTINCT FROM OLD.rejection_note
      OR NEW.rejected_at  IS DISTINCT FROM OLD.rejected_at
    THEN
      RAISE EXCEPTION 'אין הרשאה לערוך שדות אלה במשימה';
    END IF;

    -- Employees may NOT set status to completed (only managers approve)
    IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
      RAISE EXCEPTION 'רק אחראי מחלקה יכול לאשר השלמת משימה';
    END IF;
    -- Employees cannot edit a finalized completed task
    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'משימה הושלמה ואושרה — לא ניתן לעדכן';
    END IF;
  END IF;

  -- Handle status transitions / timestamps
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
