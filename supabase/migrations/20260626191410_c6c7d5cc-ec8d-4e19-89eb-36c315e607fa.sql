
DROP POLICY IF EXISTS "Users can view coworkers in their department" ON public.profiles;

CREATE OR REPLACE VIEW public.department_coworkers
WITH (security_invoker = off) AS
SELECT
  p.id,
  p.full_name,
  p.department_id,
  p.is_active,
  p.on_leave,
  p.avatar_url,
  p.job_title
FROM public.profiles p
WHERE p.department_id IS NOT NULL
  AND p.department_id = public.get_my_department_id();

REVOKE ALL ON public.department_coworkers FROM PUBLIC, anon;
GRANT SELECT ON public.department_coworkers TO authenticated;
