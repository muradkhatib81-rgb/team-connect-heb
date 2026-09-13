-- Batch 24 (conservative partial): dual-read company_id on identity SELECT.
-- SELECT-only. Does NOT modify can_view_profile / has_role / permission helpers.
-- Highest-risk domain — prefer wrapping RESTRICTIVE + admin archive/log arms
-- without locking self or platform owners when my_company_ids() is empty.
--
-- MUST keep:
--   - self see own profile (auth.uid() = id) as top OR on RESTRICTIVE
--   - is_platform_owner top-level OR (owners not gated by my_company_ids())
--   - existing can_view_profile semantics for who may directory-browse,
--     with dual-read ANDed only onto that non-self/non-owner path
--
-- Canonical dual-read:
--   company_id IN (SELECT public.my_company_ids())
--   OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
--
-- BLOCKERS / residual risk (see batches_21_24_notes.md):
--   - is_platform_owner includes main_admin → main_admin still cross-company
--     (same as Batches 19–20). Closing that requires helper/role semantic change
--     (out of scope).
--   - Permissive policies ("Admins can view all profiles", view-all perm, DM)
--     left as-is; RESTRICTIVE is the effective company gate for BM/AM/DM.
--   - Full rewrite of every permissive profile SELECT in one shot deferred.

-- ---------------------------------------------------------------------------
-- profiles RESTRICTIVE directory scope — self/owner exempt; dual-read on
-- can_view_profile (BM/AM/DM directory) arms only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS authorization_profile_directory_scope ON public.profiles;
CREATE POLICY authorization_profile_directory_scope
ON public.profiles
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  auth.uid() = id
  OR public.is_platform_owner(auth.uid())
  OR (
    public.can_view_profile(auth.uid(), id, department_id, branch_id)
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- Permissive "Users can view their own profile" left unchanged.
-- Other permissive admin/DM/view-all policies left unchanged this pass
-- (RESTRICTIVE AND already narrows BM/AM/DM directory to dual-read).

-- ---------------------------------------------------------------------------
-- employee_archive SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins read archive" ON public.employee_archive;
CREATE POLICY "Admins read archive"
ON public.employee_archive
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR (
    public.is_admin(auth.uid())
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- profile_status_log SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins and view-all can read status log" ON public.profile_status_log;
CREATE POLICY "Admins and view-all can read status log"
ON public.profile_status_log
FOR SELECT
TO authenticated
USING (
  public.is_platform_owner(auth.uid())
  OR (
    (
      public.is_admin(auth.uid())
      OR public.has_view_all_employees_perm(auth.uid())
    )
    AND (
      company_id IN (SELECT public.my_company_ids())
      OR (company_id IS NULL AND public.branch_in_my_companies(branch_id))
    )
  )
);
