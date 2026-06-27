
ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS can_manage_employee_of_month boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.has_manage_employee_of_month_perm(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'main_admin')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                  WHERE user_id = _uid AND can_manage_employee_of_month = true);
$$;

CREATE TABLE IF NOT EXISTS public.employee_of_month (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text,
  image_url text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year, month, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_eom_year_month ON public.employee_of_month (year DESC, month DESC);
CREATE INDEX IF NOT EXISTS idx_eom_employee ON public.employee_of_month (employee_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_of_month TO authenticated;
GRANT ALL ON public.employee_of_month TO service_role;

ALTER TABLE public.employee_of_month ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eom_select_all_authenticated" ON public.employee_of_month
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "eom_insert_perm" ON public.employee_of_month
  FOR INSERT TO authenticated
  WITH CHECK (public.has_manage_employee_of_month_perm(auth.uid()));

CREATE POLICY "eom_update_perm" ON public.employee_of_month
  FOR UPDATE TO authenticated
  USING (public.has_manage_employee_of_month_perm(auth.uid()))
  WITH CHECK (public.has_manage_employee_of_month_perm(auth.uid()));

CREATE POLICY "eom_delete_perm" ON public.employee_of_month
  FOR DELETE TO authenticated
  USING (public.has_manage_employee_of_month_perm(auth.uid()));

CREATE TRIGGER trg_eom_updated_at BEFORE UPDATE ON public.employee_of_month
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
