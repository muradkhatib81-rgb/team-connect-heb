-- Batch 16: dual-read company_id scoping on SELECT for low-risk content/catalog tables.
-- Tables already have nullable company_id (batches 7–8 / migrations 20260912220000–230000).
-- Form:
--   is_platform_owner(auth.uid())
--   OR company_id IN (SELECT public.my_company_ids())
--   OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
-- Write / RESTRICTIVE ALL policies unchanged (incl. break_policy_branch_scope CAB).

DROP POLICY IF EXISTS morning_board_items_select_scoped ON public.morning_board_items;
CREATE POLICY morning_board_items_select_scoped
  ON public.morning_board_items
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS branch_banners_select_scoped ON public.branch_banners;
CREATE POLICY branch_banners_select_scoped
  ON public.branch_banners
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS break_policy_select_scoped ON public.break_policy;
CREATE POLICY break_policy_select_scoped
  ON public.break_policy
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NULL
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS job_titles_select_scoped ON public.job_titles;
CREATE POLICY job_titles_select_scoped
  ON public.job_titles
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS break_settings_select_scoped ON public.break_settings;
CREATE POLICY break_settings_select_scoped
  ON public.break_settings
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS shift_definitions_select_scoped ON public.shift_definitions;
CREATE POLICY shift_definitions_select_scoped
  ON public.shift_definitions
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS shift_definition_day_hours_select_scoped ON public.shift_definition_day_hours;
CREATE POLICY shift_definition_day_hours_select_scoped
  ON public.shift_definition_day_hours
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS employee_of_month_select_scoped ON public.employee_of_month;
CREATE POLICY employee_of_month_select_scoped
  ON public.employee_of_month
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );