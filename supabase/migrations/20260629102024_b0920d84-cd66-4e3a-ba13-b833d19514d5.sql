REVOKE EXECUTE ON FUNCTION public.archive_employee(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_employee(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_employee(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_employee(uuid, text) TO service_role;