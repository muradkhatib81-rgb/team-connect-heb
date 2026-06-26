
-- 1) Add 'closed' value to task_status enum
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'closed' AFTER 'completed';

-- 2) Closure tracking columns
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3) Helper: can the user close a completed task?
CREATE OR REPLACE FUNCTION public.has_task_close_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR ((public.has_role(_user_id,'branch_manager') OR public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND can_manage_tasks = true));
$$;
REVOKE EXECUTE ON FUNCTION public.has_task_close_perm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_task_close_perm(uuid) TO authenticated;

-- 4) Rewrite trigger to allow completed -> closed transition (only for admin-created tasks)
CREATE OR REPLACE FUNCTION public.tasks_guard_assignee_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  -- Allow closure transition: completed -> closed
  IF OLD.status = 'completed' AND NEW.status = 'closed' THEN
    IF NOT public.has_task_close_perm(auth.uid()) THEN
      RAISE EXCEPTION 'אין הרשאה לבצע סגירה סופית';
    END IF;
    IF NOT creator_is_admin THEN
      RAISE EXCEPTION 'סגירה סופית זמינה רק למשימות שנוצרו ע"י מנהל ראשי / סניף / סגן';
    END IF;
    NEW.closed_at := now();
    NEW.closed_by := auth.uid();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Closed is terminal
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'משימה נסגרה — לא ניתן לעדכן';
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

    IF NEW.status = 'completed' AND OLD.status <> 'completed' AND NOT is_approver THEN
      RAISE EXCEPTION 'רק המאשר המורשה יכול לאשר השלמת משימה';
    END IF;

    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'משימה הושלמה ואושרה — לא ניתן לעדכן';
    END IF;
  ELSE
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

  IF NEW.status NOT IN ('completed','pending_approval','closed') THEN
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
    NEW.approved_at  := NULL;
    NEW.approved_by  := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- 5) Recurrence instruction images
CREATE TABLE IF NOT EXISTS public.task_recurrence_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurrence_id uuid NOT NULL REFERENCES public.task_recurrences(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_recurrence_images TO authenticated;
GRANT ALL ON public.task_recurrence_images TO service_role;
ALTER TABLE public.task_recurrence_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rec_images_view" ON public.task_recurrence_images
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.task_recurrences r WHERE r.id = recurrence_id));

CREATE POLICY "rec_images_insert" ON public.task_recurrence_images
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.task_recurrences r
      WHERE r.id = recurrence_id
        AND (
          public.has_task_management_perm(auth.uid())
          OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = r.department_id AND d.manager_id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = r.department_id AND public.has_role(auth.uid(),'department_manager'))
        )
    )
  );

CREATE POLICY "rec_images_delete" ON public.task_recurrence_images
  FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR public.has_task_management_perm(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.task_recurrences r
      WHERE r.id = recurrence_id
        AND EXISTS (SELECT 1 FROM public.departments d WHERE d.id = r.department_id AND d.manager_id = auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS rec_images_rec_idx ON public.task_recurrence_images(recurrence_id);

-- 6) Limit to 5 instruction images per recurrence
CREATE OR REPLACE FUNCTION public.task_recurrence_images_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE c INT;
BEGIN
  SELECT COUNT(*) INTO c FROM public.task_recurrence_images WHERE recurrence_id = NEW.recurrence_id;
  IF c >= 5 THEN
    RAISE EXCEPTION 'ניתן להעלות עד 5 תמונות הסבר למשימה חוזרת';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS task_recurrence_images_limit_trg ON public.task_recurrence_images;
CREATE TRIGGER task_recurrence_images_limit_trg
  BEFORE INSERT ON public.task_recurrence_images
  FOR EACH ROW EXECUTE FUNCTION public.task_recurrence_images_limit();

-- 7) Widen task-images storage SELECT so dept employees can view (signed URLs)
DROP POLICY IF EXISTS "task-images: read own or task-mgr" ON storage.objects;
CREATE POLICY "task-images: read auth"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'task-images');

-- 8) Allow dept employees to INSERT task_images (for completion proof) — already covered for assignee/admin/dept mgr; widen to dept member
DROP POLICY IF EXISTS "Task images insert" ON public.task_images;
CREATE POLICY "Task images insert" ON public.task_images
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id
        AND (
          public.has_task_management_perm(auth.uid())
          OR t.assignee_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = t.department_id AND d.manager_id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = t.department_id)
        )
    )
  );
