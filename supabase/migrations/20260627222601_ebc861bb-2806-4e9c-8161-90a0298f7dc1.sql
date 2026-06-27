-- Column-level privileges: hide sensitive columns from direct profiles SELECTs.
-- Sensitive fields remain accessible only via SECURITY DEFINER RPCs
-- (get_profile_contact / list_profiles_contact) that enforce per-caller checks.

REVOKE SELECT ON public.profiles FROM PUBLIC;
REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.profiles FROM authenticated;

GRANT SELECT
  (id, full_name, job_title, is_active, created_at, updated_at,
   department_id, on_leave, avatar_url)
  ON public.profiles TO authenticated;

-- Preserve existing write privileges (RLS still gates row access).
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;