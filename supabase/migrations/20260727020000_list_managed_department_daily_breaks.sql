-- Read-only: department heads see today's break journal for their own
-- managed department only (no cross-department visibility).
--
-- Mirrors list_managed_department_active_breaks: SECURITY DEFINER, scoped to
-- departments.manager_id = auth.uid(). Does not change roles, grants, or RLS.

CREATE OR REPLACE FUNCTION public.list_managed_department_daily_breaks()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  full_name text,
  job_title text,
  break_type text,
  duration_minutes integer,
  status text,
  created_at timestamptz,
  requested_at timestamptz,
  planned_start timestamptz,
  started_at timestamptz,
  ends_at timestamptz,
  completed_at timestamptz,
  department_id uuid,
  department_name text,
  approver_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    br.id,
    br.user_id,
    COALESCE(p.full_name, '—') AS full_name,
    p.job_title,
    COALESCE(bs.name, 'הפסקה') AS break_type,
    COALESCE(br.duration_minutes, br.planned_duration, 0) AS duration_minutes,
    br.status::text,
    br.created_at,
    br.requested_at,
    br.planned_start,
    br.started_at,
    br.ends_at,
    br.completed_at,
    d.id AS department_id,
    d.name AS department_name,
    ap.full_name AS approver_name
  FROM public.break_requests br
  JOIN public.profiles p ON p.id = br.user_id
  JOIN public.departments d ON d.id = p.department_id
  LEFT JOIN public.break_settings bs ON bs.id = br.break_setting_id
  LEFT JOIN public.profiles ap ON ap.id = br.approved_by
  WHERE d.manager_id = auth.uid()
    AND (COALESCE(br.created_at, br.requested_at) AT TIME ZONE 'Asia/Jerusalem')::date
      = (now() AT TIME ZONE 'Asia/Jerusalem')::date
  ORDER BY COALESCE(br.requested_at, br.created_at) ASC NULLS LAST, p.full_name ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.list_managed_department_daily_breaks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_managed_department_daily_breaks() TO authenticated, service_role;
