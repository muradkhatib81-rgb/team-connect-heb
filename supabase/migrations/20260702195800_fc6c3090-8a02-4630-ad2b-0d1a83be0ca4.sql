
-- 1. Relax employee-domain membership fields so non-employee identities can exist without them.
ALTER TABLE public.profiles ALTER COLUMN department_id DROP NOT NULL;
-- branch_id is already nullable.

-- 2. Enforcement trigger on profiles.
-- Rule: a user classified as a Platform Owner (non-employee identity today)
-- MUST have department_id IS NULL AND branch_id IS NULL.
-- Non-owner (employee) rows are unchanged; we do not tighten the employee side here
-- to preserve backward compatibility with the current employee-provisioning flow,
-- which sets branch_id after profile insert.
CREATE OR REPLACE FUNCTION public.enforce_non_employee_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.is_platform_owner(NEW.id) THEN
    IF NEW.department_id IS NOT NULL OR NEW.branch_id IS NOT NULL THEN
      RAISE EXCEPTION 'זהות שאינה עובד (בעל מערכת) לא יכולה להיות משויכת למחלקה או לסניף';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_non_employee_membership ON public.profiles;
CREATE TRIGGER trg_enforce_non_employee_membership
BEFORE INSERT OR UPDATE OF department_id, branch_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_non_employee_membership();

-- 3. Symmetric guard on user_roles: granting a Platform Ownership role requires
-- the target profile to already be cleared of employee-domain fields.
CREATE OR REPLACE FUNCTION public.enforce_owner_grant_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dept uuid;
  v_branch uuid;
BEGIN
  IF NEW.role NOT IN ('system_admin'::public.app_role, 'main_admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  SELECT department_id, branch_id INTO v_dept, v_branch
  FROM public.profiles WHERE id = NEW.user_id;

  IF v_dept IS NOT NULL OR v_branch IS NOT NULL THEN
    RAISE EXCEPTION 'לא ניתן להעניק הרשאת בעל מערכת למשתמש המשויך למחלקה או לסניף. יש לנתק את השיוך תחילה.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_owner_grant_membership ON public.user_roles;
CREATE TRIGGER trg_enforce_owner_grant_membership
BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_owner_grant_membership();

-- 4. Adjust handle_new_user() so non-employee identities are provisioned without a default department.
-- Also swap insertion order (user_roles before profiles) so the profiles trigger
-- can correctly detect Platform Ownership at insertion time.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_count INT;
  assigned_role public.app_role;
  meta_role text;
  meta_dept_code text;
  meta_dept_id_text text;
  resolved_dept_id uuid;
  must_change boolean;
  is_owner boolean;
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

  is_owner := assigned_role IN ('system_admin'::public.app_role, 'main_admin'::public.app_role);

  -- Non-employee identities: no department resolution.
  IF NOT is_owner THEN
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
  END IF;

  -- Insert role first so the profiles trigger can see Platform Ownership.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);

  INSERT INTO public.profiles (id, full_name, id_number, department_id, job_title, phone, must_change_password)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
    NULLIF(NEW.raw_user_meta_data->>'id_number', ''),
    resolved_dept_id,  -- NULL for Platform Owners
    NULLIF(NEW.raw_user_meta_data->>'job_title', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    must_change
  );

  RETURN NEW;
END;
$$;

-- 5. One-time data cleanup: detach existing Platform Owners from any department/branch.
-- Temporarily disable the profiles trigger to avoid re-checking on the very row we are fixing
-- (it would still pass, but we're being explicit). Cleanup itself sets NULLs, which trigger accepts.
UPDATE public.profiles p
   SET department_id = NULL,
       branch_id = NULL
 WHERE public.is_platform_owner(p.id)
   AND (p.department_id IS NOT NULL OR p.branch_id IS NOT NULL);
