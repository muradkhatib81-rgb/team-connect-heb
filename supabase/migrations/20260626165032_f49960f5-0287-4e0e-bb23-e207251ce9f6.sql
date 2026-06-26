
-- Ensure every profile has a department_id (fallback to "general")
UPDATE public.profiles p
SET department_id = (SELECT id FROM public.departments WHERE code = 'general' LIMIT 1)
WHERE p.department_id IS NULL;

ALTER TABLE public.profiles ALTER COLUMN department_id SET NOT NULL;

-- Replace handle_new_user to stop writing the legacy enum column
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  user_count INT;
  assigned_role public.app_role;
  meta_role text;
  meta_dept_code text;
  meta_dept_id_text text;
  resolved_dept_id uuid;
  must_change boolean;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;

  meta_role := NULLIF(NEW.raw_user_meta_data->>'role', '');
  meta_dept_code := NULLIF(NEW.raw_user_meta_data->>'department', '');
  meta_dept_id_text := NULLIF(NEW.raw_user_meta_data->>'department_id', '');

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

  IF meta_dept_id_text IS NOT NULL THEN
    BEGIN
      resolved_dept_id := meta_dept_id_text::uuid;
    EXCEPTION WHEN others THEN
      resolved_dept_id := NULL;
    END;
  END IF;

  IF resolved_dept_id IS NULL AND meta_dept_code IS NOT NULL THEN
    SELECT id INTO resolved_dept_id FROM public.departments WHERE code = meta_dept_code LIMIT 1;
  END IF;

  IF resolved_dept_id IS NULL THEN
    SELECT id INTO resolved_dept_id FROM public.departments WHERE code = 'general' LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, full_name, id_number, department_id, job_title, phone, must_change_password)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
    NULLIF(NEW.raw_user_meta_data->>'id_number', ''),
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

-- Drop the legacy enum column and type
ALTER TABLE public.profiles DROP COLUMN IF EXISTS department;
DROP TYPE IF EXISTS public.department;
