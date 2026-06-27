
-- =========================================
-- Tasks Pro Upgrade — Phase 1
-- target_scope, multi-dept, multi-assignees,
-- requires_approval, activity log, comments
-- =========================================

-- 1) Enum for target scope
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_target_scope') THEN
    CREATE TYPE public.task_target_scope AS ENUM ('all_departments','departments','single_department');
  END IF;
END $$;

-- 2) Columns on tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS target_scope public.task_target_scope NOT NULL DEFAULT 'single_department',
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT true,
  ALTER COLUMN department_id DROP NOT NULL;

-- 3) task_departments (multi-dept targets)
CREATE TABLE IF NOT EXISTS public.task_departments (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, department_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_departments TO authenticated;
GRANT ALL ON public.task_departments TO service_role;
ALTER TABLE public.task_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_departments_select" ON public.task_departments;
CREATE POLICY "task_departments_select" ON public.task_departments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_departments.task_id)
  );
DROP POLICY IF EXISTS "task_departments_write" ON public.task_departments;
CREATE POLICY "task_departments_write" ON public.task_departments
  FOR ALL TO authenticated
  USING (
    public.has_task_edit_perm(auth.uid())
    OR public.has_task_create_perm(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_departments.task_id AND t.created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.has_task_edit_perm(auth.uid())
    OR public.has_task_create_perm(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_departments.task_id AND t.created_by = auth.uid()
    )
  );

-- 4) task_assignees (multi assignees)
CREATE TABLE IF NOT EXISTS public.task_assignees (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS task_assignees_user_idx ON public.task_assignees(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_assignees TO authenticated;
GRANT ALL ON public.task_assignees TO service_role;
ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_assignees_select" ON public.task_assignees;
CREATE POLICY "task_assignees_select" ON public.task_assignees
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_assignees.task_id)
  );
DROP POLICY IF EXISTS "task_assignees_write" ON public.task_assignees;
CREATE POLICY "task_assignees_write" ON public.task_assignees
  FOR ALL TO authenticated
  USING (
    public.has_task_edit_perm(auth.uid())
    OR public.has_task_create_perm(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_assignees.task_id AND t.created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.has_task_edit_perm(auth.uid())
    OR public.has_task_create_perm(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_assignees.task_id AND t.created_by = auth.uid()
    )
  );

-- 5) task_activity_log (immutable history)
CREATE TABLE IF NOT EXISTS public.task_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_activity_log_task_idx ON public.task_activity_log(task_id, created_at);
GRANT SELECT, INSERT ON public.task_activity_log TO authenticated;
GRANT ALL ON public.task_activity_log TO service_role;
ALTER TABLE public.task_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_activity_select" ON public.task_activity_log;
CREATE POLICY "task_activity_select" ON public.task_activity_log
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_activity_log.task_id)
  );
DROP POLICY IF EXISTS "task_activity_insert" ON public.task_activity_log;
CREATE POLICY "task_activity_insert" ON public.task_activity_log
  FOR INSERT TO authenticated WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_activity_log.task_id)
  );

-- 6) task_comments
CREATE TABLE IF NOT EXISTS public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_comments_task_idx ON public.task_comments(task_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_comments_select" ON public.task_comments;
CREATE POLICY "task_comments_select" ON public.task_comments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_comments.task_id)
  );
DROP POLICY IF EXISTS "task_comments_insert" ON public.task_comments;
CREATE POLICY "task_comments_insert" ON public.task_comments
  FOR INSERT TO authenticated WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_comments.task_id)
  );
DROP POLICY IF EXISTS "task_comments_update_own" ON public.task_comments;
CREATE POLICY "task_comments_update_own" ON public.task_comments
  FOR UPDATE TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
DROP POLICY IF EXISTS "task_comments_delete_own_or_admin" ON public.task_comments;
CREATE POLICY "task_comments_delete_own_or_admin" ON public.task_comments
  FOR DELETE TO authenticated USING (
    author_id = auth.uid() OR public.has_role(auth.uid(),'main_admin')
  );

-- 7) UPDATED tasks visibility policy:
--   - main_admin / managers with view perm
--   - creator
--   - dept manager (managed dept)
--   - user's own department (single or multi)
--   - explicit assignee (assignee_id or in task_assignees)
--   - target_scope = all_departments
DROP POLICY IF EXISTS "Task visibility" ON public.tasks;
CREATE POLICY "Task visibility" ON public.tasks
  FOR SELECT TO authenticated USING (
    public.has_task_edit_perm(auth.uid())
    OR public.is_admin(auth.uid())
    OR created_by = auth.uid()
    OR assignee_id = auth.uid()
    OR target_scope = 'all_departments'
    OR EXISTS (SELECT 1 FROM public.task_assignees ta WHERE ta.task_id = tasks.id AND ta.user_id = auth.uid())
    OR department_id IN (SELECT d.id FROM public.departments d WHERE d.manager_id = auth.uid())
    OR department_id = (SELECT p.department_id FROM public.profiles p WHERE p.id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.task_departments td
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE td.task_id = tasks.id AND td.department_id = p.department_id
    )
    OR EXISTS (
      SELECT 1 FROM public.task_departments td
      JOIN public.departments d ON d.id = td.department_id
      WHERE td.task_id = tasks.id AND d.manager_id = auth.uid()
    )
  );

-- 8) tasks INSERT policy widened to allow dept-less (all_departments) targets
DROP POLICY IF EXISTS "Task insert" ON public.tasks;
CREATE POLICY "Task insert" ON public.tasks
  FOR INSERT TO authenticated WITH CHECK (
    public.has_task_create_perm(auth.uid())
    OR (department_id IS NOT NULL AND department_id IN (
      SELECT d.id FROM public.departments d WHERE d.manager_id = auth.uid()
    ))
  );

-- 9) Update guard trigger to auto-close when requires_approval=false
CREATE OR REPLACE FUNCTION public.tasks_guard_assignee_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_priv boolean;
  in_dept boolean;
  is_assignee boolean;
  is_approver boolean;
  creator_is_admin boolean;
BEGIN
  is_priv := public.has_task_edit_perm(auth.uid())
    OR EXISTS (SELECT 1 FROM public.departments WHERE id = OLD.department_id AND manager_id = auth.uid());
  in_dept := OLD.department_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND department_id = OLD.department_id);
  is_assignee := OLD.assignee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = OLD.id AND user_id = auth.uid());
  is_approver := public.can_approve_task(OLD.id, auth.uid())
    OR public.has_task_approve_perm(auth.uid());
  creator_is_admin := OLD.created_by IS NOT NULL
    AND (public.has_role(OLD.created_by,'main_admin')
      OR public.has_role(OLD.created_by,'branch_manager')
      OR public.has_role(OLD.created_by,'assistant_manager'));

  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'משימה נסגרה — לא ניתן לעדכן';
  END IF;

  -- Auto-close path when no approval is required
  IF OLD.requires_approval = false
     AND NEW.status IN ('completed','pending_approval','pending_closure')
     AND OLD.status NOT IN ('completed','pending_approval','pending_closure','closed')
  THEN
    NEW.status := 'closed';
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.completed_by := COALESCE(NEW.completed_by, auth.uid());
    NEW.closed_at := now();
    NEW.closed_by := auth.uid();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('pending_closure','completed') AND NEW.status = 'closed' THEN
    IF NOT public.has_task_close_perm(auth.uid()) THEN
      RAISE EXCEPTION 'אין הרשאה לבצע סגירה סופית';
    END IF;
    NEW.closed_at := now();
    NEW.closed_by := auth.uid();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' AND OLD.status = 'pending_approval' AND creator_is_admin THEN
    NEW.status := 'pending_closure';
  END IF;

  IF NOT is_priv THEN
    IF NOT in_dept AND NOT is_approver AND NOT is_assignee THEN
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
      OR NEW.target_scope IS DISTINCT FROM OLD.target_scope
      OR NEW.requires_approval IS DISTINCT FROM OLD.requires_approval
    THEN
      RAISE EXCEPTION 'אין הרשאה לערוך שדות אלה במשימה';
    END IF;

    IF NEW.status IN ('completed','pending_closure')
      AND OLD.status NOT IN ('completed','pending_closure')
      AND NOT is_approver THEN
      RAISE EXCEPTION 'רק המאשר המורשה יכול לאשר השלמת משימה';
    END IF;

    IF OLD.status IN ('completed','pending_closure') THEN
      RAISE EXCEPTION 'משימה אושרה — ניתן לבצע רק סגירה סופית בהתאם להרשאות';
    END IF;
  ELSE
    IF NEW.status IN ('completed','pending_closure')
      AND OLD.status NOT IN ('completed','pending_closure')
      AND NOT is_approver THEN
      RAISE EXCEPTION 'יוצר המשימה אינו יכול לאשר אותה בעצמו';
    END IF;
  END IF;

  IF NEW.status = 'pending_approval' AND OLD.status <> 'pending_approval' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.completed_by := COALESCE(NEW.completed_by, auth.uid());
  END IF;

  IF NEW.status IN ('completed','pending_closure')
    AND OLD.status NOT IN ('completed','pending_closure') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, OLD.completed_at, now());
    NEW.completed_by := COALESCE(NEW.completed_by, OLD.completed_by);
    NEW.approved_at := now();
    NEW.approved_by := auth.uid();
    NEW.rejection_note := NULL;
    NEW.rejected_at := NULL;
  END IF;

  IF NEW.status NOT IN ('completed','pending_approval','pending_closure','closed') THEN
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
    NEW.approved_at := NULL;
    NEW.approved_by := NULL;
    NEW.closed_at := NULL;
    NEW.closed_by := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

-- 10) Activity log triggers
CREATE OR REPLACE FUNCTION public.log_task_created()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.task_activity_log (task_id, actor_id, event, payload)
  VALUES (NEW.id, NEW.created_by, 'created',
    jsonb_build_object('title', NEW.title, 'status', NEW.status, 'priority', NEW.priority));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tasks_log_created ON public.tasks;
CREATE TRIGGER tasks_log_created AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_created();

CREATE OR REPLACE FUNCTION public.log_task_status_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.task_activity_log (task_id, actor_id, event, payload)
    VALUES (NEW.id, auth.uid(), 'status_changed',
      jsonb_build_object('from', OLD.status, 'to', NEW.status,
        'rejection_note', NEW.rejection_note));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tasks_log_status ON public.tasks;
CREATE TRIGGER tasks_log_status AFTER UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_status_change();

-- 11) Helper: list assignees of a task (used by UI)
CREATE OR REPLACE FUNCTION public.get_task_assignees(_task_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT ta.user_id, p.full_name, p.avatar_url
  FROM public.task_assignees ta
  JOIN public.profiles p ON p.id = ta.user_id
  WHERE ta.task_id = _task_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_task_assignees(uuid) TO authenticated;
