ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.schedules s
SET updated_by = COALESCE(
  (
    SELECT a.actor_id
    FROM public.schedule_audit_log a
    WHERE a.schedule_id = s.id
      AND a.action IN ('updated','copied','submitted','approved','published')
      AND a.actor_id IS NOT NULL
    ORDER BY a.created_at DESC
    LIMIT 1
  ),
  s.submitted_by,
  s.approved_by,
  s.created_by
)
WHERE s.updated_by IS NULL;

CREATE OR REPLACE FUNCTION public.get_profiles_basic_info(user_ids uuid[])
RETURNS TABLE (
  id uuid,
  full_name text,
  job_title text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.job_title
  FROM public.profiles p
  WHERE p.id = ANY(user_ids);
$$;

REVOKE EXECUTE ON FUNCTION public.get_profiles_basic_info(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profiles_basic_info(uuid[]) TO authenticated;