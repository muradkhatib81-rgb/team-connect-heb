
-- Unique ID number (allow multiple NULLs for legacy rows but enforce uniqueness on real values)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_id_number_unique
  ON public.profiles (id_number)
  WHERE id_number IS NOT NULL;

-- Updated signup handler: pull profile fields from auth metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INT;
  assigned_role public.app_role;
  meta_dept public.department;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;

  IF user_count = 0 THEN
    assigned_role := 'main_admin';
  ELSE
    assigned_role := 'employee';
  END IF;

  BEGIN
    meta_dept := COALESCE(NULLIF(NEW.raw_user_meta_data->>'department', ''), 'general')::public.department;
  EXCEPTION WHEN others THEN
    meta_dept := 'general';
  END;

  INSERT INTO public.profiles (id, full_name, id_number, department, job_title, phone)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
    NULLIF(NEW.raw_user_meta_data->>'id_number', ''),
    meta_dept,
    NULLIF(NEW.raw_user_meta_data->>'job_title', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', '')
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
