REVOKE EXECUTE ON FUNCTION public.reject_platform_owner_as_employee() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reject_platform_owner_as_employee() TO service_role;