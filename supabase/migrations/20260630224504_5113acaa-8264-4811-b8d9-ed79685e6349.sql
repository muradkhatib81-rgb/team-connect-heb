
-- Fix permissions regression after branch implementation.
-- user_task_permissions is keyed by user_id (one row per user). Scoping
-- visibility to the active branch broke manager perms after a profile's
-- branch_id changed. Keep perms user-scoped; sync branch_id with the
-- owner profile; seed missing rows for existing managers.

-- 1) Drop the restrictive branch filter on user_task_permissions; the
--    existing user_id / main_admin policies are sufficient.
DROP POLICY IF EXISTS branch_scope_restriction ON public.user_task_permissions;

-- 2) Backfill mismatched / null branch_id from the owner profile.
UPDATE public.user_task_permissions u
SET branch_id = p.branch_id
FROM public.profiles p
WHERE p.id = u.user_id
  AND u.branch_id IS DISTINCT FROM p.branch_id;

-- 3) Seed default permissions for existing managers that have no row yet.
INSERT INTO public.user_task_permissions (
  user_id, branch_id,
  can_view_dashboard, can_view_all_employees, can_view_employee_details,
  can_view_schedule, can_view_tasks
)
SELECT DISTINCT ur.user_id, p.branch_id, true, true, true, true, true
FROM public.user_roles ur
JOIN public.profiles p ON p.id = ur.user_id
WHERE ur.role IN ('branch_manager'::public.app_role, 'assistant_manager'::public.app_role)
  AND NOT EXISTS (
    SELECT 1 FROM public.user_task_permissions u WHERE u.user_id = ur.user_id
  )
ON CONFLICT (user_id) DO NOTHING;

-- 4) Keep user_task_permissions.branch_id in sync when a profile is
--    reassigned to another branch.
CREATE OR REPLACE FUNCTION public.sync_user_task_permissions_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    UPDATE public.user_task_permissions
       SET branch_id = NEW.branch_id
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_task_permissions_branch ON public.profiles;
CREATE TRIGGER trg_sync_user_task_permissions_branch
AFTER UPDATE OF branch_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_user_task_permissions_branch();
