-- Batch 1d: scope open branch catalog SELECT policies.
-- Same rule as company_settings 1c: platform owner OR active branch.
-- Skips departments/leave_* (already have restrictive scopes), branches
-- (needed for switcher until company_id), and platform-global AI catalogs.

DROP POLICY IF EXISTS "Authenticated can view job titles" ON public.job_titles;
DROP POLICY IF EXISTS job_titles_select_scoped ON public.job_titles;
CREATE POLICY job_titles_select_scoped
  ON public.job_titles
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NOT DISTINCT FROM public.current_active_branch()
  );

DROP POLICY IF EXISTS "Anyone authenticated can view breaks" ON public.break_settings;
DROP POLICY IF EXISTS break_settings_select_scoped ON public.break_settings;
CREATE POLICY break_settings_select_scoped
  ON public.break_settings
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NOT DISTINCT FROM public.current_active_branch()
  );

DROP POLICY IF EXISTS shift_def_select ON public.shift_definitions;
DROP POLICY IF EXISTS shift_definitions_select_scoped ON public.shift_definitions;
CREATE POLICY shift_definitions_select_scoped
  ON public.shift_definitions
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NOT DISTINCT FROM public.current_active_branch()
  );

DROP POLICY IF EXISTS shift_def_day_hours_select ON public.shift_definition_day_hours;
DROP POLICY IF EXISTS shift_definition_day_hours_select_scoped ON public.shift_definition_day_hours;
CREATE POLICY shift_definition_day_hours_select_scoped
  ON public.shift_definition_day_hours
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.shift_definitions sd
      WHERE sd.id = shift_definition_day_hours.shift_definition_id
        AND sd.branch_id IS NOT DISTINCT FROM public.current_active_branch()
    )
  );

DROP POLICY IF EXISTS eom_select_all_authenticated ON public.employee_of_month;
DROP POLICY IF EXISTS "eom_select_all_authenticated" ON public.employee_of_month;
DROP POLICY IF EXISTS employee_of_month_select_scoped ON public.employee_of_month;
CREATE POLICY employee_of_month_select_scoped
  ON public.employee_of_month
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NOT DISTINCT FROM public.current_active_branch()
  );
