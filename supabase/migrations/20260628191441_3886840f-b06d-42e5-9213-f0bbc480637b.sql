UPDATE public.schedules s
SET updated_by = COALESCE(
  (
    SELECT a.actor_id
    FROM public.schedule_audit_log a
    WHERE a.schedule_id = s.id
      AND a.action IN ('updated','copied')
      AND a.actor_id IS NOT NULL
    ORDER BY a.created_at DESC
    LIMIT 1
  ),
  s.submitted_by,
  s.created_by
);

DROP FUNCTION IF EXISTS public.get_profiles_basic_info(uuid[]);

CREATE FUNCTION public.get_profiles_basic_info(user_ids uuid[])
RETURNS TABLE (
  id uuid,
  full_name text,
  job_title text,
  role text,
  role_label text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked_roles AS (
    SELECT
      ur.user_id,
      ur.role,
      CASE ur.role
        WHEN 'main_admin' THEN 1
        WHEN 'branch_manager' THEN 2
        WHEN 'assistant_manager' THEN 3
        WHEN 'department_manager' THEN 4
        WHEN 'employee' THEN 5
        ELSE 99
      END AS role_rank
    FROM public.user_roles ur
    WHERE ur.user_id = ANY(user_ids)
  ), top_roles AS (
    SELECT DISTINCT ON (user_id) user_id, role
    FROM ranked_roles
    ORDER BY user_id, role_rank
  )
  SELECT
    p.id,
    p.full_name,
    p.job_title,
    tr.role::text AS role,
    CASE tr.role::text
      WHEN 'main_admin' THEN 'מנהל ראשי'
      WHEN 'branch_manager' THEN 'מנהל סניף'
      WHEN 'assistant_manager' THEN 'סגן מנהל'
      WHEN 'department_manager' THEN 'אחראי מחלקה'
      WHEN 'employee' THEN 'עובד'
      ELSE NULL
    END AS role_label
  FROM public.profiles p
  LEFT JOIN top_roles tr ON tr.user_id = p.id
  WHERE p.id = ANY(user_ids);
$$;

REVOKE EXECUTE ON FUNCTION public.get_profiles_basic_info(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profiles_basic_info(uuid[]) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'announcement_targets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.announcement_targets;
  END IF;
END $$;