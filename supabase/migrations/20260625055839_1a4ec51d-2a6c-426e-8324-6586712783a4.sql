CREATE OR REPLACE FUNCTION public.has_main_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'main_admin')
$$;

REVOKE EXECUTE ON FUNCTION public.has_main_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_main_admin() TO anon, authenticated;