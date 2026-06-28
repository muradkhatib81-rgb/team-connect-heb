CREATE OR REPLACE FUNCTION public.get_communication_sender(_user_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  avatar_url text,
  job_title text,
  department_name text,
  top_role public.app_role
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    p.job_title,
    d.name,
    COALESCE(
      (
        SELECT ur.role
        FROM public.user_roles ur
        WHERE ur.user_id = p.id
          AND ur.role <> 'department_manager'::public.app_role
        ORDER BY
          CASE ur.role
            WHEN 'main_admin'         THEN 1
            WHEN 'branch_manager'     THEN 2
            WHEN 'assistant_manager'  THEN 3
            WHEN 'employee'           THEN 4
            ELSE 5
          END
        LIMIT 1
      ),
      'employee'::public.app_role
    ) AS top_role
  FROM public.profiles p
  LEFT JOIN public.departments d ON d.id = p.department_id
  WHERE p.id = _user_id
$$;

REVOKE ALL ON FUNCTION public.get_communication_sender(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_communication_sender(uuid) TO authenticated;
