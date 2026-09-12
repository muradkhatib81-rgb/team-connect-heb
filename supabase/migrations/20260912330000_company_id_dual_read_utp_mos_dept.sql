-- Batch 18: dual-read company_id on UTP, management_on_shift, break_policy RESTRICTIVE, departments SELECT.
-- Canonical row scope:
--   company_id IN (SELECT public.my_company_ids())
--   OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))

-- ---------------------------------------------------------------------------
-- user_task_permissions SELECT
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
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = user_task_permissions.user_id
        AND ur.role = 'assistant_manager'::public.app_role
    )
  )
);

-- UTP INSERT/UPDATE: swap BIC for dual-read on row + target profile
DROP POLICY IF EXISTS "Branch managers insert assistant permissions" ON public.user_task_permissions;
CREATE POLICY "Branch managers insert assistant permissions"
ON public.user_task_permissions
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'branch_manager'::public.app_role)
  AND (
    company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.profiles target
    WHERE target.id = user_task_permissions.user_id
      AND (
        target.company_id IN (SELECT public.my_company_ids())
        OR (target.company_id IS NULL AND public.branch_in_my_companies(target.branch_id))
      )
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
  AND (
    company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.profiles target
    WHERE target.id = user_task_permissions.user_id
      AND (
        target.company_id IN (SELECT public.my_company_ids())
        OR (target.company_id IS NULL AND public.branch_in_my_companies(target.branch_id))
      )
  )
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = user_task_permissions.user_id
      AND ur.role = 'assistant_manager'::public.app_role
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'branch_manager'::public.app_role)
  AND (
    company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.profiles target
    WHERE target.id = user_task_permissions.user_id
      AND (
        target.company_id IN (SELECT public.my_company_ids())
        OR (target.company_id IS NULL AND public.branch_in_my_companies(target.branch_id))
      )
  )
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = user_task_permissions.user_id
      AND ur.role = 'assistant_manager'::public.app_role
  )
);

-- ---------------------------------------------------------------------------
-- management_on_shift: CAB → company dual-read (+ system/platform owner)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS mos_select_branch ON public.management_on_shift;
CREATE POLICY mos_select_branch ON public.management_on_shift
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.is_system_admin(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

DROP POLICY IF EXISTS branch_scope_restriction ON public.management_on_shift;
CREATE POLICY branch_scope_restriction ON public.management_on_shift AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.is_system_admin(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR public.is_system_admin(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

-- MOS insert self: keep role checks; scope branch via dual-read
DROP POLICY IF EXISTS mos_insert_self ON public.management_on_shift;
CREATE POLICY mos_insert_self ON public.management_on_shift
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'branch_manager'::public.app_role)
      OR public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
      OR branch_id = COALESCE(
        public.current_active_branch(),
        (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- break_policy RESTRICTIVE: CAB → dual-read (keep NULL branch global rows)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS break_policy_branch_scope ON public.break_policy;
CREATE POLICY break_policy_branch_scope ON public.break_policy AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NULL
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NULL
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );

-- ---------------------------------------------------------------------------
-- departments SELECT: close USING(true) → dual-read
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone authenticated can view departments" ON public.departments;
DROP POLICY IF EXISTS departments_select_scoped ON public.departments;
CREATE POLICY departments_select_scoped
  ON public.departments FOR SELECT TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR company_id IN (SELECT public.my_company_ids())
    OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
  );
