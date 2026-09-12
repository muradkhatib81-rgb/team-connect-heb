-- Batch 1c: scope company_settings SELECT to active branch + platform owners.
-- Mirrors existing UPDATE policies (current_active_branch / is_platform_owner).
-- Does not change roles or introduce company_id isolation yet.

DROP POLICY IF EXISTS company_settings_select_authenticated ON public.company_settings;
DROP POLICY IF EXISTS company_settings_select_all ON public.company_settings;
DROP POLICY IF EXISTS company_settings_select_scoped ON public.company_settings;

CREATE POLICY company_settings_select_scoped
  ON public.company_settings
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NOT DISTINCT FROM public.current_active_branch()
  );
