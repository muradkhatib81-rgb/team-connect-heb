-- Restrict self-service profile UPDATEs to safe columns only.
-- Does NOT alter user_roles, user_task_permissions, push, or leave workflows.
-- Managers/owners with write access (and SECURITY DEFINER RPCs) keep full updates.

CREATE OR REPLACE FUNCTION public.enforce_profiles_self_update_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Not a self-update (manager/RPC targeting someone else) → allow.
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM OLD.id THEN
    RETURN NEW;
  END IF;

  -- Platform owner or branch profile writer editing self → allow full update.
  IF public.is_platform_owner(auth.uid())
     OR public.can_write_profile_in_active_branch(OLD.branch_id, 'update')
     OR public.can_write_profile_in_active_branch(NEW.branch_id, 'update')
  THEN
    RETURN NEW;
  END IF;

  -- Self-service: only preferred_language, avatar_url, updated_at may change.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.first_name IS DISTINCT FROM OLD.first_name
     OR NEW.last_name IS DISTINCT FROM OLD.last_name
     OR NEW.full_name IS DISTINCT FROM OLD.full_name
     OR NEW.id_number IS DISTINCT FROM OLD.id_number
     OR NEW.phone IS DISTINCT FROM OLD.phone
     OR NEW.job_title IS DISTINCT FROM OLD.job_title
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at
     OR NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
     OR NEW.on_leave IS DISTINCT FROM OLD.on_leave
     OR NEW.leave_start_date IS DISTINCT FROM OLD.leave_start_date
     OR NEW.leave_end_date IS DISTINCT FROM OLD.leave_end_date
     OR NEW.leave_type_code IS DISTINCT FROM OLD.leave_type_code
     OR NEW.excluded_from_headcount IS DISTINCT FROM OLD.excluded_from_headcount
     OR NEW.excluded_from_schedule IS DISTINCT FROM OLD.excluded_from_schedule
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'profile_self_update_forbidden';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_profiles_self_update_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_profiles_self_update_columns() TO service_role;

DROP TRIGGER IF EXISTS trg_enforce_profiles_self_update_columns ON public.profiles;
CREATE TRIGGER trg_enforce_profiles_self_update_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profiles_self_update_columns();

COMMENT ON FUNCTION public.enforce_profiles_self_update_columns() IS
  'Blocks self-updates of sensitive profile columns; allows preferred_language/avatar_url/updated_at only unless caller can write profiles.';
