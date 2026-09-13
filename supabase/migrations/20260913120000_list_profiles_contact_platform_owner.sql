-- Allow platform owners to read employee contact phones via list/get_profile_contact.
-- Matches latest list_profiles_contact body; adds is_platform_owner(auth.uid()).
-- Never expose other platform-owner profiles as contacts.

CREATE OR REPLACE FUNCTION public.list_profiles_contact()
 RETURNS TABLE(id uuid, id_number text, phone text, must_change_password boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.id_number, p.phone, p.must_change_password
  FROM public.profiles p
  WHERE (
      public.is_platform_owner(auth.uid())
      OR public.has_role(auth.uid(), 'main_admin')
      OR public.has_view_employee_details_perm(auth.uid())
    )
    AND NOT public.is_platform_owner(p.id);
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_contact(_id uuid)
 RETURNS TABLE(id uuid, id_number text, phone text, must_change_password boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.id_number, p.phone, p.must_change_password
  FROM public.profiles p
  WHERE p.id = _id
    AND (
      auth.uid() = _id
      OR public.is_platform_owner(auth.uid())
      OR public.has_role(auth.uid(), 'main_admin')
      OR public.has_view_employee_details_perm(auth.uid())
    )
    AND (auth.uid() = _id OR NOT public.is_platform_owner(p.id));
$function$;