
DROP VIEW IF EXISTS public.department_coworkers;

CREATE OR REPLACE FUNCTION public.get_department_coworkers()
RETURNS TABLE (
  id uuid,
  full_name text,
  department_id uuid,
  is_active boolean,
  on_leave boolean,
  avatar_url text,
  job_title text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.department_id, p.is_active, p.on_leave, p.avatar_url, p.job_title
  FROM public.profiles p
  WHERE p.department_id IS NOT NULL
    AND p.department_id = public.get_my_department_id();
$$;

REVOKE EXECUTE ON FUNCTION public.get_department_coworkers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_department_coworkers() TO authenticated;

CREATE VIEW public.department_coworkers
WITH (security_invoker = on) AS
SELECT * FROM public.get_department_coworkers();

REVOKE ALL ON public.department_coworkers FROM PUBLIC, anon;
GRANT SELECT ON public.department_coworkers TO authenticated;
