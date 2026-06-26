ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'pending_closure' AFTER 'completed';

DROP POLICY IF EXISTS "Task update" ON public.tasks;
CREATE POLICY "Task update"
  ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (
    public.has_task_edit_perm(auth.uid())
    OR public.has_task_approve_perm(auth.uid())
    OR public.has_task_close_perm(auth.uid())
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
    OR department_id = (SELECT profiles.department_id FROM public.profiles WHERE profiles.id = auth.uid())
  )
  WITH CHECK (
    public.has_task_edit_perm(auth.uid())
    OR public.has_task_approve_perm(auth.uid())
    OR public.has_task_close_perm(auth.uid())
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
    OR department_id = (SELECT profiles.department_id FROM public.profiles WHERE profiles.id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.tasks_guard_assignee_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_priv boolean;
  in_dept boolean;
  is_approver boolean;
  creator_is_admin boolean;
BEGIN
  is_priv := public.has_task_edit_perm(auth.uid())
    OR EXISTS (SELECT 1 FROM public.departments WHERE id = OLD.department_id AND manager_id = auth.uid());
  in_dept := EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND department_id = OLD.department_id);
  is_approver := public.can_approve_task(OLD.id, auth.uid());
  creator_is_admin := OLD.created_by IS NOT NULL
    AND (public.has_role(OLD.created_by,'main_admin')
      OR public.has_role(OLD.created_by,'branch_manager')
      OR public.has_role(OLD.created_by,'assistant_manager'));

  -- Closed is terminal.
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'משימה נסגרה — לא ניתן לעדכן';
  END IF;

  -- Allow final closure after department-manager approval.
  -- Keep completed -> closed for already-approved historical tasks.
  IF OLD.status IN ('pending_closure', 'completed') AND NEW.status = 'closed' THEN
    IF NOT public.has_task_close_perm(auth.uid()) THEN
      RAISE EXCEPTION 'אין הרשאה לבצע סגירה סופית';
    END IF;
    IF NOT creator_is_admin THEN
      RAISE EXCEPTION 'סגירה סופית זמינה רק למשימות שנוצרו ע״י מנהל ראשי / סניף / סגן';
    END IF;
    NEW.closed_at := now();
    NEW.closed_by := auth.uid();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Backward-compatible safeguard: if an older client sends completed for an
  -- admin-created task approval, move it to pending_closure automatically.
  IF NEW.status = 'completed' AND OLD.status = 'pending_approval' AND creator_is_admin THEN
    NEW.status := 'pending_closure';
  END IF;

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

    IF NEW.status IN ('completed', 'pending_closure')
      AND OLD.status NOT IN ('completed', 'pending_closure')
      AND NOT is_approver THEN
      RAISE EXCEPTION 'רק המאשר המורשה יכול לאשר השלמת משימה';
    END IF;

    IF OLD.status IN ('completed', 'pending_closure') THEN
      RAISE EXCEPTION 'משימה אושרה — ניתן לבצע רק סגירה סופית בהתאם להרשאות';
    END IF;
  ELSE
    IF NEW.status IN ('completed', 'pending_closure')
      AND OLD.status NOT IN ('completed', 'pending_closure')
      AND NOT is_approver THEN
      RAISE EXCEPTION 'יוצר המשימה אינו יכול לאשר אותה בעצמו';
    END IF;
  END IF;

  IF NEW.status = 'pending_approval' AND OLD.status <> 'pending_approval' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.completed_by := COALESCE(NEW.completed_by, auth.uid());
  END IF;

  IF NEW.status IN ('completed', 'pending_closure')
    AND OLD.status NOT IN ('completed', 'pending_closure') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, OLD.completed_at, now());
    NEW.completed_by := COALESCE(NEW.completed_by, OLD.completed_by);
    NEW.approved_at := now();
    NEW.approved_by := auth.uid();
    NEW.rejection_note := NULL;
    NEW.rejected_at := NULL;
  END IF;

  IF NEW.status NOT IN ('completed', 'pending_approval', 'pending_closure', 'closed') THEN
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

REVOKE ALL ON FUNCTION public.tasks_guard_assignee_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasks_guard_update ON public.tasks;
CREATE TRIGGER tasks_guard_update
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.tasks_guard_assignee_update();