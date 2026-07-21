-- Return a display name for management-on-shift cards even when employees
-- cannot SELECT manager profiles directly (directory RLS).
CREATE OR REPLACE FUNCTION public.get_management_on_shift()
RETURNS TABLE(
  id uuid,
  user_id uuid,
  started_at timestamptz,
  full_name text,
  avatar_url text,
  job_title text,
  role app_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.user_id,
    m.started_at,
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '')
    ) AS full_name,
    p.avatar_url,
    p.job_title,
    (
      SELECT ur.role
      FROM public.user_roles ur
      WHERE ur.user_id = m.user_id
        AND ur.role IN ('branch_manager'::app_role, 'assistant_manager'::app_role)
      ORDER BY CASE ur.role
        WHEN 'branch_manager'::app_role THEN 1
        WHEN 'assistant_manager'::app_role THEN 2
        ELSE 9
      END
      LIMIT 1
    ) AS role
  FROM public.management_on_shift m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE (public.current_active_branch() IS NULL
         OR m.branch_id = public.current_active_branch())
    AND NOT public.is_platform_owner(m.user_id)
  ORDER BY m.started_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_management_on_shift() TO authenticated;
