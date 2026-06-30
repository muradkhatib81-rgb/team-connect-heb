
-- Block delete of the system_admin user_role
CREATE OR REPLACE FUNCTION public.protect_system_admin_role_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'system_admin'::public.app_role THEN
    RAISE EXCEPTION 'לא ניתן להסיר את הרשאת מנהל המערכת הראשי';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_admin_role_delete ON public.user_roles;
CREATE TRIGGER trg_protect_system_admin_role_delete
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_admin_role_delete();

-- Block update of the system_admin user_role row (cannot reassign to another user or change role)
CREATE OR REPLACE FUNCTION public.protect_system_admin_role_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'system_admin'::public.app_role
     AND (NEW.role <> OLD.role OR NEW.user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'לא ניתן לשנות את הרשאת מנהל המערכת הראשי';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_admin_role_update ON public.user_roles;
CREATE TRIGGER trg_protect_system_admin_role_update
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_admin_role_update();

-- Block delete or deactivation of the profile that holds system_admin
CREATE OR REPLACE FUNCTION public.protect_system_admin_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_sysadmin boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT public.is_system_admin(OLD.id) INTO _is_sysadmin;
    IF _is_sysadmin THEN
      RAISE EXCEPTION 'לא ניתן למחוק את חשבון מנהל המערכת הראשי';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT public.is_system_admin(OLD.id) INTO _is_sysadmin;
    IF _is_sysadmin AND COALESCE(NEW.is_active,true) = false THEN
      RAISE EXCEPTION 'לא ניתן להשבית את חשבון מנהל המערכת הראשי';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_admin_profile ON public.profiles;
CREATE TRIGGER trg_protect_system_admin_profile
  BEFORE UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_admin_profile();
