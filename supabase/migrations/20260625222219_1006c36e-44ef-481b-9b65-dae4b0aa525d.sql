
-- ============== ENUMS ==============
DO $$ BEGIN
  CREATE TYPE public.task_priority AS ENUM ('low','medium','high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.task_status AS ENUM ('new','in_progress','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.task_recurrence_frequency AS ENUM ('daily','weekly','monthly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============== user_task_permissions ==============
CREATE TABLE IF NOT EXISTS public.user_task_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  can_manage_tasks BOOLEAN NOT NULL DEFAULT false,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_task_permissions TO authenticated;
GRANT ALL ON public.user_task_permissions TO service_role;
ALTER TABLE public.user_task_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view task permissions"
  ON public.user_task_permissions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Main admin manages task permissions"
  ON public.user_task_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'main_admin'))
  WITH CHECK (public.has_role(auth.uid(),'main_admin'));

-- has_task_management_perm()
CREATE OR REPLACE FUNCTION public.has_task_management_perm(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id,'main_admin')
    OR (
      (public.has_role(_user_id,'branch_manager') OR public.has_role(_user_id,'assistant_manager'))
      AND EXISTS (SELECT 1 FROM public.user_task_permissions
                  WHERE user_id = _user_id AND can_manage_tasks = true)
    )
$$;

REVOKE EXECUTE ON FUNCTION public.has_task_management_perm(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_task_management_perm(UUID) TO authenticated;

-- ============== tasks ==============
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  priority public.task_priority NOT NULL DEFAULT 'medium',
  status public.task_status NOT NULL DEFAULT 'new',
  notes TEXT,
  completed_at TIMESTAMPTZ,
  recurrence_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_dept_idx ON public.tasks(department_id);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON public.tasks(assignee_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON public.tasks(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- SELECT: admins/task-mgr see all; dept manager sees their dept;
-- employee/anyone sees tasks of their own department; assignee sees own.
CREATE POLICY "Task visibility"
  ON public.tasks FOR SELECT TO authenticated USING (
    public.has_task_management_perm(auth.uid())
    OR public.is_admin(auth.uid())
    OR assignee_id = auth.uid()
    OR created_by = auth.uid()
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
    OR department_id = (SELECT department_id FROM public.profiles WHERE id = auth.uid())
  );

-- INSERT: task-management perm OR dept manager of that dept
CREATE POLICY "Task insert"
  ON public.tasks FOR INSERT TO authenticated WITH CHECK (
    public.has_task_management_perm(auth.uid())
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
  );

-- UPDATE: admin/task-mgr OR dept manager OR assignee (limited fields via trigger)
CREATE POLICY "Task update"
  ON public.tasks FOR UPDATE TO authenticated USING (
    public.has_task_management_perm(auth.uid())
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
    OR assignee_id = auth.uid()
  ) WITH CHECK (
    public.has_task_management_perm(auth.uid())
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
    OR assignee_id = auth.uid()
  );

-- DELETE: only task-management perm
CREATE POLICY "Task delete"
  ON public.tasks FOR DELETE TO authenticated USING (
    public.has_task_management_perm(auth.uid())
  );

-- Trigger: assignee can only edit status/notes/completed_at; not protected fields.
CREATE OR REPLACE FUNCTION public.tasks_guard_assignee_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_priv BOOLEAN;
BEGIN
  is_priv := public.has_task_management_perm(auth.uid())
    OR EXISTS (SELECT 1 FROM public.departments WHERE id = OLD.department_id AND manager_id = auth.uid());
  IF NOT is_priv THEN
    -- Plain employee / assignee: restrict to status, notes, completed_at, updated_at
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
  END IF;
  -- Auto-set completed_at when transitioning to completed
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'completed' THEN
    NEW.completed_at := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tasks_guard_update ON public.tasks;
CREATE TRIGGER tasks_guard_update
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_guard_assignee_update();

CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============== task_images ==============
CREATE TABLE IF NOT EXISTS public.task_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_images_task_idx ON public.task_images(task_id);

GRANT SELECT, INSERT, DELETE ON public.task_images TO authenticated;
GRANT ALL ON public.task_images TO service_role;
ALTER TABLE public.task_images ENABLE ROW LEVEL SECURITY;

-- SELECT: anyone who can see the parent task
CREATE POLICY "Task images view"
  ON public.task_images FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id)
  );

-- INSERT: assignee, dept manager, or task-mgr
CREATE POLICY "Task images insert"
  ON public.task_images FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id AND (
        public.has_task_management_perm(auth.uid())
        OR t.assignee_id = auth.uid()
        OR t.department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
      )
    )
  );

-- DELETE: uploader, dept manager, or task-mgr
CREATE POLICY "Task images delete"
  ON public.task_images FOR DELETE TO authenticated USING (
    uploaded_by = auth.uid()
    OR public.has_task_management_perm(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id AND t.department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
    )
  );

-- Max 5 images per task
CREATE OR REPLACE FUNCTION public.task_images_limit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE c INT;
BEGIN
  SELECT COUNT(*) INTO c FROM public.task_images WHERE task_id = NEW.task_id;
  IF c >= 5 THEN
    RAISE EXCEPTION 'ניתן להעלות עד 5 תמונות לכל משימה';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS task_images_limit_trg ON public.task_images;
CREATE TRIGGER task_images_limit_trg
  BEFORE INSERT ON public.task_images
  FOR EACH ROW EXECUTE FUNCTION public.task_images_limit();

-- ============== task_recurrences ==============
CREATE TABLE IF NOT EXISTS public.task_recurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  priority public.task_priority NOT NULL DEFAULT 'medium',
  frequency public.task_recurrence_frequency NOT NULL,
  days_of_week SMALLINT[] NOT NULL DEFAULT '{}', -- 0=Sunday..6=Saturday
  day_of_month SMALLINT,
  time_of_day TEXT NOT NULL DEFAULT '08:00', -- HH:MM, branch local (Asia/Jerusalem)
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_generated_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_recurrences_next_run_idx ON public.task_recurrences(next_run_at) WHERE is_active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_recurrences TO authenticated;
GRANT ALL ON public.task_recurrences TO service_role;
ALTER TABLE public.task_recurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recurrence visibility"
  ON public.task_recurrences FOR SELECT TO authenticated USING (
    public.has_task_management_perm(auth.uid())
    OR public.is_admin(auth.uid())
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
    OR department_id = (SELECT department_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Recurrence insert"
  ON public.task_recurrences FOR INSERT TO authenticated WITH CHECK (
    public.has_task_management_perm(auth.uid())
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
  );

CREATE POLICY "Recurrence update"
  ON public.task_recurrences FOR UPDATE TO authenticated USING (
    public.has_task_management_perm(auth.uid())
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
  ) WITH CHECK (
    public.has_task_management_perm(auth.uid())
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
  );

CREATE POLICY "Recurrence delete"
  ON public.task_recurrences FOR DELETE TO authenticated USING (
    public.has_task_management_perm(auth.uid())
    OR department_id IN (SELECT id FROM public.departments WHERE manager_id = auth.uid())
  );

CREATE TRIGGER task_recurrences_set_updated_at
  BEFORE UPDATE ON public.task_recurrences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- FK from tasks.recurrence_id (after table exists)
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_recurrence_id_fkey;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_recurrence_id_fkey
  FOREIGN KEY (recurrence_id) REFERENCES public.task_recurrences(id) ON DELETE SET NULL;

-- Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_images;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_recurrences;
