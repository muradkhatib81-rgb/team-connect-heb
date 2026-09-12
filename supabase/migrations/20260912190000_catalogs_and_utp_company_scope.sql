-- Batch 4: upgrade catalog SELECT scopes still using only current_active_branch()
-- to company-aware public.branch_in_my_companies(uuid) (live from 20260912170000).
-- Also tighten user_task_permissions to is_platform_owner + company branch scope.
-- Does not add company_id columns. Does not touch ai_providers, ops_error_types,
-- attendance_* punch settings, departments, or leave_*.

-- ---------------------------------------------------------------------------
-- company_settings
-- 1c used: owner OR branch_id IS NOT DISTINCT FROM current_active_branch()
-- (null↔null only when the caller has no active branch). After SaaS, null
-- platform-default rows stay owner-only: branch_in_my_companies(NULL) is false.
-- App reads are already eq-filtered to the active branch; each branch has its
-- own company_settings row. Do not open null rows to every authenticated user.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS company_settings_select_scoped ON public.company_settings;
CREATE POLICY company_settings_select_scoped
  ON public.company_settings
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

-- ---------------------------------------------------------------------------
-- Branch catalogs (batch 1d) — same company-aware SELECT as batches 2–3
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS job_titles_select_scoped ON public.job_titles;
CREATE POLICY job_titles_select_scoped
  ON public.job_titles
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

DROP POLICY IF EXISTS break_settings_select_scoped ON public.break_settings;
CREATE POLICY break_settings_select_scoped
  ON public.break_settings
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

DROP POLICY IF EXISTS shift_definitions_select_scoped ON public.shift_definitions;
CREATE POLICY shift_definitions_select_scoped
  ON public.shift_definitions
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

-- 20260912163100 added shift_definition_day_hours.branch_id; use it directly.
DROP POLICY IF EXISTS shift_definition_day_hours_select_scoped ON public.shift_definition_day_hours;
CREATE POLICY shift_definition_day_hours_select_scoped
  ON public.shift_definition_day_hours
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

DROP POLICY IF EXISTS employee_of_month_select_scoped ON public.employee_of_month;
CREATE POLICY employee_of_month_select_scoped
  ON public.employee_of_month
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.branch_in_my_companies(branch_id)
  );

-- ---------------------------------------------------------------------------
-- user_task_permissions (from 20260630225416)
-- SELECT: own row, platform owner, or branch_manager of an assistant in-company.
-- INSERT/UPDATE: current_active_branch() → branch_in_my_companies (row + target).
-- ALL manage: has_role main_admin → is_platform_owner.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users and branch managers view task permissions" ON public.user_task_permissions;
CREATE POLICY "Users and branch managers view task permissions"
ON public.user_task_permissions
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_platform_owner(auth.uid())
  OR (
    public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    AND public.branch_in_my_companies(branch_id)
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = user_task_permissions.user_id
        AND ur.role = 'assistant_manager'::public.app_role
    )
  )
);

DROP POLICY IF EXISTS "Main admin manages task permissions" ON public.user_task_permissions;
CREATE POLICY "Main admin manages task permissions"
ON public.user_task_permissions
FOR ALL
TO authenticated
USING (public.is_platform_owner(auth.uid()))
WITH CHECK (public.is_platform_owner(auth.uid()));

DROP POLICY IF EXISTS "Branch managers insert assistant permissions" ON public.user_task_permissions;
CREATE POLICY "Branch managers insert assistant permissions"
ON public.user_task_permissions
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'branch_manager'::public.app_role)
  AND public.branch_in_my_companies(branch_id)
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.profiles target
    WHERE target.id = user_task_permissions.user_id
      AND public.branch_in_my_companies(target.branch_id)
  )
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = user_task_permissions.user_id
      AND ur.role = 'assistant_manager'::public.app_role
  )
);

DROP POLICY IF EXISTS "Branch managers update assistant permissions" ON public.user_task_permissions;
CREATE POLICY "Branch managers update assistant permissions"
ON public.user_task_permissions
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'branch_manager'::public.app_role)
  AND public.branch_in_my_companies(branch_id)
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = user_task_permissions.user_id
      AND ur.role = 'assistant_manager'::public.app_role
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'branch_manager'::public.app_role)
  AND public.branch_in_my_companies(branch_id)
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.profiles target
    WHERE target.id = user_task_permissions.user_id
      AND public.branch_in_my_companies(target.branch_id)
  )
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = user_task_permissions.user_id
      AND ur.role = 'assistant_manager'::public.app_role
  )
);
