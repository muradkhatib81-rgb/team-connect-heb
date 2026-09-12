-- Company isolation batches 2a–2c (gradual SaaS foundation).
-- 2a: helper functions
-- 2b: restrict branches SELECT
-- 2c: company-scope remaining open branch-scoped catalogs
-- Does not add company_id columns to operational tables yet.

-- ---------------------------------------------------------------------------
-- 2a helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.company_id_of_branch(_branch_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT cba.company_id
  FROM public.company_branch_assignments cba
  WHERE cba.source_branch_id = _branch_id
    AND cba.deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.my_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT DISTINCT cba.company_id
  FROM public.profile_scope_internal(auth.uid()) s
  JOIN public.company_branch_assignments cba
    ON cba.source_branch_id = s.branch_id
   AND cba.deleted_at IS NULL
  WHERE auth.uid() IS NOT NULL
    AND s.branch_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.branch_in_my_companies(_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT
    CASE
      WHEN auth.uid() IS NULL THEN false
      WHEN public.is_platform_owner(auth.uid()) THEN true
      WHEN _branch_id IS NULL THEN false
      -- Always allow the caller's own profile branch (even if unassigned to a company yet).
      WHEN EXISTS (
        SELECT 1
        FROM public.profile_scope_internal(auth.uid()) s
        WHERE s.branch_id IS NOT DISTINCT FROM _branch_id
      ) THEN true
      -- Same company via platform assignment map.
      WHEN EXISTS (
        SELECT 1
        FROM public.profile_scope_internal(auth.uid()) s
        JOIN public.company_branch_assignments mine
          ON mine.source_branch_id = s.branch_id
         AND mine.deleted_at IS NULL
        JOIN public.company_branch_assignments theirs
          ON theirs.company_id = mine.company_id
         AND theirs.deleted_at IS NULL
        WHERE theirs.source_branch_id = _branch_id
      ) THEN true
      ELSE false
    END;
$$;

REVOKE ALL ON FUNCTION public.company_id_of_branch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_company_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.branch_in_my_companies(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_id_of_branch(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_company_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.branch_in_my_companies(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2b branches SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view branches" ON public.branches;
DROP POLICY IF EXISTS branches_select_scoped ON public.branches;
CREATE POLICY branches_select_scoped
  ON public.branches
  FOR SELECT
  TO authenticated
  USING (public.branch_in_my_companies(id));

-- ---------------------------------------------------------------------------
-- 2c remaining open branch catalogs
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "mbi_select_authenticated" ON public.morning_board_items;
DROP POLICY IF EXISTS morning_board_items_select_scoped ON public.morning_board_items;
CREATE POLICY morning_board_items_select_scoped
  ON public.morning_board_items
  FOR SELECT
  TO authenticated
  USING (public.branch_in_my_companies(branch_id));

DROP POLICY IF EXISTS "banners_select_authenticated" ON public.branch_banners;
DROP POLICY IF EXISTS branch_banners_select_scoped ON public.branch_banners;
CREATE POLICY branch_banners_select_scoped
  ON public.branch_banners
  FOR SELECT
  TO authenticated
  USING (public.branch_in_my_companies(branch_id));

DROP POLICY IF EXISTS "break_policy_select_all_auth" ON public.break_policy;
DROP POLICY IF EXISTS break_policy_select_scoped ON public.break_policy;
CREATE POLICY break_policy_select_scoped
  ON public.break_policy
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NULL
    OR public.branch_in_my_companies(branch_id)
  );
