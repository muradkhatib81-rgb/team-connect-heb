-- Read-only: department heads see currently-active breaks for their own
-- managed department only.
--
-- Existing break_requests SELECT policies let a caller see only their own
-- rows (or all rows when they have has_break_manage_perm). Department heads
-- therefore cannot build a "who is on break in my department" card from a
-- direct table query.
--
-- This function grants no management capability and does not change roles,
-- permissions, or RLS policies. Visibility is limited to departments where
-- departments.manager_id = auth.uid(), matching the same manager assignment
-- already used by the department-head dashboard.

CREATE OR REPLACE FUNCTION public.list_managed_department_active_breaks()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  full_name text,
  break_type text,
  duration_minutes integer,
  started_at timestamptz,
  ends_at timestamptz,
  department_id uuid,
  department_name text
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
    COALESCE(bs.name, 'הפסקה') AS break_type,
    COALESCE(br.duration_minutes, br.planned_duration, 0) AS duration_minutes,
    br.started_at,
    br.ends_at,
    d.id AS department_id,
    d.name AS department_name
  FROM public.break_requests br
  JOIN public.profiles p ON p.id = br.user_id
  JOIN public.departments d ON d.id = p.department_id
  LEFT JOIN public.break_settings bs ON bs.id = br.break_setting_id
  WHERE br.status = 'active'::public.break_request_status
    AND d.manager_id = auth.uid()
  ORDER BY br.started_at ASC NULLS LAST, p.full_name ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.list_managed_department_active_breaks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_managed_department_active_breaks() TO authenticated, service_role;
