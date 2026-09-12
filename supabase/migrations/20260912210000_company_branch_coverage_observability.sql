-- Batch 6: company_id foundation — observability only (no ALTER on operational tables).
-- Coverage view (service_role) + owner-only report RPCs via company_id_of_branch().

CREATE OR REPLACE VIEW public.company_branch_coverage_v
WITH (security_invoker = true)
AS
SELECT
  b.id AS branch_id,
  b.name AS branch_name,
  b.is_active AS branch_is_active,
  cba.id AS assignment_id,
  cba.company_id,
  c.name AS company_name,
  (cba.id IS NOT NULL) AS is_assigned,
  public.company_id_of_branch(b.id) AS resolved_company_id
FROM public.branches b
LEFT JOIN public.company_branch_assignments cba
  ON cba.source_branch_id = b.id
 AND cba.deleted_at IS NULL
LEFT JOIN public.companies c
  ON c.id = cba.company_id
 AND c.deleted_at IS NULL;

COMMENT ON VIEW public.company_branch_coverage_v IS
  'Batch 6 read-only: branch to company assignment coverage. No denormalized company_id on ops tables.';

REVOKE ALL ON public.company_branch_coverage_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.company_branch_coverage_v TO service_role;

CREATE OR REPLACE FUNCTION public.report_unassigned_branches()
RETURNS TABLE (
  branch_id uuid,
  branch_name text,
  branch_is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'platform owner only';
  END IF;
  RETURN QUERY
  SELECT b.id, b.name, b.is_active
  FROM public.branches b
  WHERE public.company_id_of_branch(b.id) IS NULL
  ORDER BY b.name;
END;
$$;

REVOKE ALL ON FUNCTION public.report_unassigned_branches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_unassigned_branches() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.report_company_branch_coverage()
RETURNS TABLE (
  branch_id uuid,
  branch_name text,
  branch_is_active boolean,
  assignment_id uuid,
  company_id uuid,
  company_name text,
  is_assigned boolean,
  resolved_company_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'platform owner only';
  END IF;
  RETURN QUERY
  SELECT
    v.branch_id,
    v.branch_name,
    v.branch_is_active,
    v.assignment_id,
    v.company_id,
    v.company_name,
    v.is_assigned,
    v.resolved_company_id
  FROM public.company_branch_coverage_v v
  ORDER BY v.branch_name;
END;
$$;

REVOKE ALL ON FUNCTION public.report_company_branch_coverage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_company_branch_coverage() TO authenticated, service_role;