
-- 1) Remove the hardcoded static default so trg_set_branch_id can stamp
--    the row with the current active branch on insert.
ALTER TABLE public.employee_of_month ALTER COLUMN branch_id DROP DEFAULT;

-- 2) Backfill any legacy rows that were stamped with the historic default
--    UUID but whose employee actually belongs to a different branch, so
--    branch-scoped visibility is accurate.
UPDATE public.employee_of_month e
   SET branch_id = p.branch_id
  FROM public.profiles p
 WHERE p.id = e.employee_id
   AND p.branch_id IS NOT NULL
   AND (e.branch_id IS NULL OR e.branch_id <> p.branch_id);

-- 3) Harden the RPC so it enforces branch scope even though it is
--    SECURITY DEFINER (which otherwise bypasses RLS). System admins
--    with no active branch selected still see everything (unchanged).
CREATE OR REPLACE FUNCTION public.get_employees_of_month(_year integer, _month integer)
 RETURNS TABLE(id uuid, year integer, month integer, employee_id uuid, reason text, image_url text, full_name text, avatar_url text, job_title text, department_name text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id, e.year, e.month, e.employee_id, e.reason, e.image_url,
         p.full_name, p.avatar_url, p.job_title, d.name AS department_name,
         e.created_at
  FROM public.employee_of_month e
  LEFT JOIN public.profiles p ON p.id = e.employee_id
  LEFT JOIN public.departments d ON d.id = p.department_id
  WHERE e.year = _year
    AND e.month = _month
    AND (
      public.current_active_branch() IS NULL
      OR e.branch_id = public.current_active_branch()
    )
  ORDER BY e.created_at;
$function$;
