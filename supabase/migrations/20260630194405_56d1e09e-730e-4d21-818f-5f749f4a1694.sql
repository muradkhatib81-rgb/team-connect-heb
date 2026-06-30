
-- 1. branches table
CREATE TABLE IF NOT EXISTS public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  address text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO authenticated;
GRANT ALL ON public.branches TO service_role;

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view branches"
  ON public.branches FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Main admin can insert branches"
  ON public.branches FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'main_admin'));

CREATE POLICY "Main admin can update branches"
  ON public.branches FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'main_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'main_admin'));

CREATE POLICY "Main admin can delete branches"
  ON public.branches FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'main_admin'));

CREATE TRIGGER trg_branches_updated_at
  BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Seed the existing branch
INSERT INTO public.branches (name, code)
VALUES ('רמי לוי שער בנימין', 'RL_SHAAR_BINYAMIN')
ON CONFLICT (code) DO NOTHING;

-- 3. Add branch_id to every existing entity, backfill, and set default
DO $$
DECLARE
  _default_branch uuid;
  _tbl text;
  _tables text[] := ARRAY[
    'departments','profiles','schedules','schedule_shifts','break_requests',
    'break_settings','tasks','task_recurrences','messages','announcements',
    'schedule_notifications','employee_of_month','employee_archive','job_titles',
    'shift_definitions','communications_audit_log','schedule_audit_log',
    'profile_status_log','task_activity_log','company_settings','user_task_permissions'
  ];
BEGIN
  SELECT id INTO _default_branch FROM public.branches WHERE code = 'RL_SHAAR_BINYAMIN';

  FOREACH _tbl IN ARRAY _tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=_tbl) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT',
        _tbl
      );
      EXECUTE format(
        'UPDATE public.%I SET branch_id = %L WHERE branch_id IS NULL',
        _tbl, _default_branch
      );
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN branch_id SET DEFAULT %L',
        _tbl, _default_branch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (branch_id)',
        _tbl || '_branch_id_idx', _tbl
      );
    END IF;
  END LOOP;
END $$;
