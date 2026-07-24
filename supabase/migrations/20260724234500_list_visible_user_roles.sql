-- Role labels for the staff a caller can already see.
--
-- Problem: the user_roles SELECT policies only let a main_admin, system_admin,
-- or a branch-scoped branch_manager read other people's roles. Every other
-- viewer (assistant manager, department head, employee) reads only their own
-- row, so management staff rendered as a plain "עובד" and manager counters
-- collapsed to 1.
--
-- This function is read-only and grants no management capability. Visibility is
-- delegated to public.can_view_profile — the very same predicate that gates the
-- profiles directory (authorization_profile_directory_scope). A caller can
-- therefore see the role of exactly the people already listed for them, and
-- nothing more. Existing policies, roles, and permissions are untouched.
--
-- Platform-owner identities stay hidden, matching the staff directory.

CREATE OR REPLACE FUNCTION public.list_visible_user_roles()
RETURNS TABLE(user_id uuid, role public.app_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id, ur.role
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE public.can_view_profile(auth.uid(), p.id, p.department_id, p.branch_id)
    AND NOT public.is_platform_owner(p.id);
$$;

REVOKE EXECUTE ON FUNCTION public.list_visible_user_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_visible_user_roles() TO authenticated, service_role;
