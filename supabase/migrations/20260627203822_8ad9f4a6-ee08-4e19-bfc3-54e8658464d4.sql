
-- Permission helper functions
CREATE OR REPLACE FUNCTION public.has_view_all_employees_perm(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = _user_id AND can_view_all_employees = true);
$$;

CREATE OR REPLACE FUNCTION public.has_view_employee_details_perm(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id,'main_admin')
      OR EXISTS (SELECT 1 FROM public.user_task_permissions
                 WHERE user_id = _user_id AND can_view_employee_details = true);
$$;

REVOKE EXECUTE ON FUNCTION public.has_view_all_employees_perm(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_view_employee_details_perm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_view_all_employees_perm(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_view_employee_details_perm(uuid) TO authenticated;

-- Add SELECT policy on profiles for users with the explicit permission
DROP POLICY IF EXISTS "Users with view-all-employees perm can view profiles" ON public.profiles;
CREATE POLICY "Users with view-all-employees perm can view profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.has_view_all_employees_perm(auth.uid()));

-- Extend secure contact lookups to honor the view-employee-details permission
CREATE OR REPLACE FUNCTION public.get_profile_contact(_id uuid)
RETURNS TABLE(id_number text, phone text, must_change_password boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id_number, p.phone, p.must_change_password
  FROM public.profiles p
  WHERE p.id = _id
    AND (
      auth.uid() = _id
      OR public.has_role(auth.uid(), 'main_admin')
      OR public.has_view_employee_details_perm(auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION public.list_profiles_contact()
RETURNS TABLE(id uuid, id_number text, phone text, must_change_password boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.id_number, p.phone, p.must_change_password
  FROM public.profiles p
  WHERE public.has_role(auth.uid(), 'main_admin')
     OR public.has_view_employee_details_perm(auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.get_profile_contact(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_profiles_contact() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_contact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_profiles_contact() TO authenticated;
