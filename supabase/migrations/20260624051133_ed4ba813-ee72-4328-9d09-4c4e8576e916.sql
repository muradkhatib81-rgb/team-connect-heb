
-- 1. departments table
CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view departments"
  ON public.departments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Main admin can insert departments"
  ON public.departments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'main_admin'));

CREATE POLICY "Main admin can update departments"
  ON public.departments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'main_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'main_admin'));

CREATE POLICY "Main admin can delete departments"
  ON public.departments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'main_admin'));

CREATE TRIGGER trg_departments_updated_at
  BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. seed default departments (codes match existing enum values)
INSERT INTO public.departments (name, code) VALUES
  ('חלב', 'dairy'),
  ('בשר', 'meat'),
  ('ירקות ופירות', 'produce'),
  ('קופות', 'cashiers'),
  ('מחסן', 'warehouse'),
  ('ניקיון', 'cleaning'),
  ('מחירים', 'pricing'),
  ('כללי', 'general');

-- 3. add department_id to profiles, backfill from existing enum column
ALTER TABLE public.profiles
  ADD COLUMN department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

UPDATE public.profiles p
SET department_id = d.id
FROM public.departments d
WHERE d.code = p.department::text;

CREATE INDEX idx_profiles_department_id ON public.profiles(department_id);

-- 4. update handle_new_user to set department_id as well
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  user_count INT;
  assigned_role public.app_role;
  meta_dept public.department;
  meta_role text;
  meta_dept_code text;
  resolved_dept_id uuid;
  must_change boolean;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;

  meta_role := NULLIF(NEW.raw_user_meta_data->>'role', '');
  meta_dept_code := NULLIF(NEW.raw_user_meta_data->>'department', '');

  IF user_count = 0 THEN
    assigned_role := 'main_admin';
    must_change := false;
  ELSE
    BEGIN
      assigned_role := COALESCE(meta_role, 'employee')::public.app_role;
    EXCEPTION WHEN others THEN
      assigned_role := 'employee';
    END;
    must_change := true;
  END IF;

  BEGIN
    meta_dept := COALESCE(meta_dept_code, 'general')::public.department;
  EXCEPTION WHEN others THEN
    meta_dept := 'general';
  END;

  SELECT id INTO resolved_dept_id FROM public.departments WHERE code = meta_dept::text LIMIT 1;
  IF resolved_dept_id IS NULL THEN
    SELECT id INTO resolved_dept_id FROM public.departments WHERE code = 'general' LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, full_name, id_number, department, department_id, job_title, phone, must_change_password)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
    NULLIF(NEW.raw_user_meta_data->>'id_number', ''),
    meta_dept,
    resolved_dept_id,
    NULLIF(NEW.raw_user_meta_data->>'job_title', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    must_change
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 5. update RLS so department_manager only sees their own department employees
DROP POLICY IF EXISTS "Department managers can view their department" ON public.profiles;

CREATE POLICY "Department managers can view their department"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'department_manager')
    AND department_id IS NOT NULL
    AND department_id IN (
      SELECT id FROM public.departments WHERE manager_id = auth.uid()
    )
  );
