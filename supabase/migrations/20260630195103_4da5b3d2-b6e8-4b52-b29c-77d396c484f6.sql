
-- Helper: is the user the system administrator?
CREATE OR REPLACE FUNCTION public.is_system_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'system_admin'::public.app_role
  )
$$;

-- Singleton enforcement: only ONE system_admin may exist
CREATE OR REPLACE FUNCTION public.enforce_single_system_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'system_admin'::public.app_role THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE role = 'system_admin'::public.app_role
        AND user_id <> NEW.user_id
    ) THEN
      RAISE EXCEPTION 'כבר קיים מנהל מערכת ראשי פעיל. ניתן להגדיר רק אחד.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_single_system_admin ON public.user_roles;
CREATE TRIGGER trg_enforce_single_system_admin
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_admin();

-- Assign system_admin to the current main_admin (only if none exists yet)
INSERT INTO public.user_roles (user_id, role)
SELECT ur.user_id, 'system_admin'::public.app_role
FROM public.user_roles ur
WHERE ur.role = 'main_admin'::public.app_role
  AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'system_admin'::public.app_role)
ORDER BY ur.user_id
LIMIT 1
ON CONFLICT (user_id, role) DO NOTHING;
