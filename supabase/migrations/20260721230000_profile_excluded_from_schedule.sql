-- Per-employee schedule exclusion: visible in grid, no shifts assigned.
-- Does not affect roles, permissions, headcount, or ability to view coworkers' schedules.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS excluded_from_schedule boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.excluded_from_schedule IS
  'When true, employee appears in schedule UI but receives no shifts. Viewing department schedules is unchanged.';

-- Expose through department_coworkers for employee schedule viewers.
DROP VIEW IF EXISTS public.department_coworkers;
DROP FUNCTION IF EXISTS public.get_department_coworkers();

CREATE OR REPLACE FUNCTION public.get_department_coworkers()
 RETURNS TABLE(
   id uuid,
   full_name text,
   department_id uuid,
   is_active boolean,
   on_leave boolean,
   avatar_url text,
   job_title text,
   excluded_from_schedule boolean
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
    p.avatar_url,
    p.job_title,
    p.excluded_from_schedule
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
