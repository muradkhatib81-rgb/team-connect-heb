
-- Restrict authenticated/anon roles from reading sensitive profile columns.
REVOKE SELECT (id_number, phone, must_change_password) ON public.profiles FROM authenticated;
REVOKE SELECT (id_number, phone, must_change_password) ON public.profiles FROM anon;

-- Per-row sensitive lookup: self or main_admin only.
CREATE OR REPLACE FUNCTION public.get_profile_contact(_id uuid)
RETURNS TABLE(id_number text, phone text, must_change_password boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id_number, p.phone, p.must_change_password
  FROM public.profiles p
  WHERE p.id = _id
    AND (auth.uid() = _id OR public.has_role(auth.uid(), 'main_admin'));
$$;

REVOKE EXECUTE ON FUNCTION public.get_profile_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_contact(uuid) TO authenticated;

-- Admin-only bulk listing for the management employees screen.
CREATE OR REPLACE FUNCTION public.list_profiles_contact()
RETURNS TABLE(id uuid, id_number text, phone text, must_change_password boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.id_number, p.phone, p.must_change_password
  FROM public.profiles p
  WHERE public.has_role(auth.uid(), 'main_admin');
$$;

REVOKE EXECUTE ON FUNCTION public.list_profiles_contact() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_profiles_contact() TO authenticated;
