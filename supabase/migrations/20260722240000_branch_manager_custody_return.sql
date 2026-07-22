-- Branch managers may always return custody taken by others in their branch.
CREATE OR REPLACE FUNCTION public.has_custody_return_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_owner(_user_id)
    OR public.has_role(_user_id, 'branch_manager'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_task_permissions p
      WHERE p.user_id = _user_id AND p.can_return_custody = true
    );
$$;
