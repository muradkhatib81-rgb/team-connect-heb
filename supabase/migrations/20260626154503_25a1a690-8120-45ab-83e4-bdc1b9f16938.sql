-- Phase 2.2: Work Schedules System

-- Enums
DO $$ BEGIN
  CREATE TYPE public.schedule_status AS ENUM ('draft','pending_approval','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.shift_type AS ENUM ('morning','evening','off');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.schedule_audit_action AS ENUM ('created','updated','submitted','approved','rejected','copied','published');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- schedules: one per department per week
CREATE TABLE IF NOT EXISTS public.schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  week_end date NOT NULL,
  status public.schedule_status NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES auth.users(id),
  submitted_by uuid REFERENCES auth.users(id),
  submitted_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id),
  rejected_at timestamptz,
  rejection_note text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(department_id, week_start)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedules TO authenticated;
GRANT ALL ON public.schedules TO service_role;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.schedule_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_date date NOT NULL,
  shift public.shift_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(schedule_id, employee_id, day_date)
);
CREATE INDEX IF NOT EXISTS idx_schedule_shifts_schedule ON public.schedule_shifts(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_shifts_employee_day ON public.schedule_shifts(employee_id, day_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_shifts TO authenticated;
GRANT ALL ON public.schedule_shifts TO service_role;
ALTER TABLE public.schedule_shifts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.schedule_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  action public.schedule_audit_action NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_audit_schedule ON public.schedule_audit_log(schedule_id);

GRANT SELECT, INSERT ON public.schedule_audit_log TO authenticated;
GRANT ALL ON public.schedule_audit_log TO service_role;
ALTER TABLE public.schedule_audit_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.schedule_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_notif_user ON public.schedule_notifications(user_id, read_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_notifications TO authenticated;
GRANT ALL ON public.schedule_notifications TO service_role;
ALTER TABLE public.schedule_notifications ENABLE ROW LEVEL SECURITY;

-- updated_at triggers
CREATE TRIGGER trg_schedules_updated_at BEFORE UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_schedule_shifts_updated_at BEFORE UPDATE ON public.schedule_shifts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper functions
CREATE OR REPLACE FUNCTION public.has_schedule_approve_perm(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR ((public.has_role(_user_id,'branch_manager') OR public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND can_approve_schedule = true));
$$;
REVOKE EXECUTE ON FUNCTION public.has_schedule_approve_perm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_schedule_approve_perm(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_schedule_create_perm(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR public.has_role(_user_id,'department_manager')
    OR ((public.has_role(_user_id,'branch_manager') OR public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND can_create_schedule = true));
$$;
REVOKE EXECUTE ON FUNCTION public.has_schedule_create_perm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_schedule_create_perm(uuid) TO authenticated;

-- RLS Policies

-- schedules
CREATE POLICY "schedules_select" ON public.schedules FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'main_admin')
  OR public.has_schedule_approve_perm(auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = schedules.department_id
             AND (status = 'approved' OR public.has_role(auth.uid(),'department_manager')))
);

CREATE POLICY "schedules_insert" ON public.schedules FOR INSERT TO authenticated
WITH CHECK (
  public.has_schedule_create_perm(auth.uid())
  AND (
    public.has_role(auth.uid(),'main_admin')
    OR (
      public.has_role(auth.uid(),'department_manager')
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = department_id)
    )
    OR ((public.has_role(auth.uid(),'branch_manager') OR public.has_role(auth.uid(),'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = auth.uid() AND can_create_schedule = true))
  )
);

CREATE POLICY "schedules_update" ON public.schedules FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(),'main_admin')
  OR public.has_schedule_approve_perm(auth.uid())
  OR (
    public.has_role(auth.uid(),'department_manager')
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = schedules.department_id)
    AND status IN ('draft','rejected')
  )
);

CREATE POLICY "schedules_delete" ON public.schedules FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(),'main_admin')
  OR (
    public.has_role(auth.uid(),'department_manager')
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = schedules.department_id)
    AND status IN ('draft','rejected')
  )
);

-- schedule_shifts
CREATE POLICY "shifts_select" ON public.schedule_shifts FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id AND (
    public.has_role(auth.uid(),'main_admin')
    OR public.has_schedule_approve_perm(auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = s.department_id
               AND (s.status = 'approved' OR public.has_role(auth.uid(),'department_manager')))
  ))
);

CREATE POLICY "shifts_write" ON public.schedule_shifts FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id AND (
    public.has_role(auth.uid(),'main_admin')
    OR (
      public.has_role(auth.uid(),'department_manager')
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = s.department_id)
      AND s.status IN ('draft','rejected')
    )
  ))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id AND (
    public.has_role(auth.uid(),'main_admin')
    OR (
      public.has_role(auth.uid(),'department_manager')
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = s.department_id)
      AND s.status IN ('draft','rejected')
    )
  ))
);

-- audit log
CREATE POLICY "audit_select" ON public.schedule_audit_log FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id AND (
    public.has_role(auth.uid(),'main_admin')
    OR public.has_schedule_approve_perm(auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.department_id = s.department_id
               AND public.has_role(auth.uid(),'department_manager'))
  ))
);
CREATE POLICY "audit_insert" ON public.schedule_audit_log FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid());

-- notifications
CREATE POLICY "notif_select" ON public.schedule_notifications FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY "notif_update_own" ON public.schedule_notifications FOR UPDATE TO authenticated
USING (user_id = auth.uid());
CREATE POLICY "notif_insert" ON public.schedule_notifications FOR INSERT TO authenticated
WITH CHECK (true);

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.schedules;
ALTER PUBLICATION supabase_realtime ADD TABLE public.schedule_shifts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.schedule_notifications;
