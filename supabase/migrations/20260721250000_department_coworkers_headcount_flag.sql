-- Expose headcount exclusion on department_coworkers for schedule summary counts.
DROP VIEW IF EXISTS public.department_coworkers;
DROP FUNCTION IF EXISTS public.get_department_coworkers();

CREATE OR REPLACE FUNCTION public.get_department_coworkers()
 RETURNS TABLE(
   id uuid,
   full_name text,
   department_id uuid,
   is_active boolean,
   on_leave boolean,
   leave_start_date date,
   leave_end_date date,
   avatar_url text,
   job_title text,
   excluded_from_schedule boolean,
   excluded_from_headcount boolean
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    p.full_name,
    p.department_id,
    p.is_active,
    p.on_leave,
    p.leave_start_date,
    p.leave_end_date,
    p.avatar_url,
    p.job_title,
    p.excluded_from_schedule,
    p.excluded_from_headcount
  FROM public.profiles p
  WHERE p.department_id IS NOT NULL
    AND p.department_id = public.get_my_department_id()
    AND NOT public.is_platform_owner(p.id);
$function$;

CREATE VIEW public.department_coworkers
WITH (security_invoker = true)
AS SELECT * FROM public.get_department_coworkers();

REVOKE ALL ON public.department_coworkers FROM PUBLIC, anon;
GRANT SELECT ON public.department_coworkers TO authenticated;
