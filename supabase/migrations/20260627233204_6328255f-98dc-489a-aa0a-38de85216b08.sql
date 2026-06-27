
CREATE OR REPLACE FUNCTION public.get_employees_of_month(_year int, _month int)
RETURNS TABLE(
  id uuid,
  year int,
  month int,
  employee_id uuid,
  reason text,
  image_url text,
  full_name text,
  avatar_url text,
  job_title text,
  department_name text,
  created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.year, e.month, e.employee_id, e.reason, e.image_url,
         p.full_name, p.avatar_url, p.job_title, d.name AS department_name,
         e.created_at
  FROM public.employee_of_month e
  LEFT JOIN public.profiles p ON p.id = e.employee_id
  LEFT JOIN public.departments d ON d.id = p.department_id
  WHERE e.year = _year AND e.month = _month
  ORDER BY e.created_at;
$$;

GRANT EXECUTE ON FUNCTION public.get_employees_of_month(int, int) TO authenticated;
