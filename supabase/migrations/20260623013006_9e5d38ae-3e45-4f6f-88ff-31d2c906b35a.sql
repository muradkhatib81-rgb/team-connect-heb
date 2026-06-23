
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true;

-- First admin shouldn't be forced (they signed up themselves with their own password)
-- Subsequent users (created by admin) default to true via column default.

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
  must_change boolean;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;

  meta_role := NULLIF(NEW.raw_user_meta_data->>'role', '');

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
    meta_dept := COALESCE(NULLIF(NEW.raw_user_meta_data->>'department', ''), 'general')::public.department;
  EXCEPTION WHEN others THEN
    meta_dept := 'general';
  END;

  INSERT INTO public.profiles (id, full_name, id_number, department, job_title, phone, must_change_password)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
    NULLIF(NEW.raw_user_meta_data->>'id_number', ''),
    meta_dept,
    NULLIF(NEW.raw_user_meta_data->>'job_title', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    must_change
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);

  RETURN NEW;
END;
$function$;

-- Make sure trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
