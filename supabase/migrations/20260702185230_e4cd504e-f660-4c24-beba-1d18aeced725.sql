REVOKE EXECUTE ON FUNCTION public.is_platform_owner(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_platform_owner(uuid) TO authenticated, service_role;