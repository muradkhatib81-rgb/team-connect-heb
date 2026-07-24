-- Activate the existing can_manage_company_settings toggle without changing
-- roles. Every mutation remains constrained to the caller's active branch.

CREATE OR REPLACE FUNCTION public.has_company_settings_manage_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(_user_id)
    OR (
      public.has_role(_user_id, 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.user_task_permissions permission
        WHERE permission.user_id = _user_id
          AND permission.can_manage_company_settings = true
      )
    );
$$;

DROP POLICY IF EXISTS company_settings_update_granular ON public.company_settings;
CREATE POLICY company_settings_update_granular
ON public.company_settings
FOR UPDATE
TO authenticated
USING (
  public.has_company_settings_manage_perm(auth.uid())
  AND branch_id = public.current_active_branch()
)
WITH CHECK (
  public.has_company_settings_manage_perm(auth.uid())
  AND branch_id = public.current_active_branch()
);

DROP POLICY IF EXISTS company_settings_update_active_branch_scope ON public.company_settings;
CREATE POLICY company_settings_update_active_branch_scope
ON public.company_settings
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (branch_id = public.current_active_branch())
WITH CHECK (branch_id = public.current_active_branch());

DROP POLICY IF EXISTS company_settings_insert_granular ON public.company_settings;
CREATE POLICY company_settings_insert_granular
ON public.company_settings
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_company_settings_manage_perm(auth.uid())
  AND branch_id = public.current_active_branch()
);

NOTIFY pgrst, 'reload schema';
