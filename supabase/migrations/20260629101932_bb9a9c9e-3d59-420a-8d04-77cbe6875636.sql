DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "Main admin can delete any profile" ON public.profiles;

CREATE POLICY "Main admin can delete any profile"
ON public.profiles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'main_admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.archive_employee(_user_id uuid, _reason text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p record;
  _deact timestamptz;
  _arch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.has_role(auth.uid(), 'main_admin') THEN
    RAISE EXCEPTION 'רק מנהל ראשי יכול לבצע מחיקה סופית של עובד';
  END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'לא ניתן למחוק את החשבון של עצמך'; END IF;

  SELECT p2.id, p2.full_name, p2.id_number, p2.job_title, p2.phone, p2.department_id,
         p2.avatar_url, p2.is_active, p2.deactivated_at, d.name AS dept_name
    INTO p
    FROM public.profiles p2
    LEFT JOIN public.departments d ON d.id = p2.department_id
   WHERE p2.id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'עובד לא נמצא'; END IF;

  _deact := COALESCE(p.deactivated_at, now());

  INSERT INTO public.employee_archive(
    original_id, id_number, full_name, job_title, phone,
    department_id, department_name, avatar_url,
    archived_by, deactivated_at, reason, snapshot
  )
  VALUES (
    p.id, p.id_number, p.full_name, p.job_title, p.phone,
    p.department_id, p.dept_name, p.avatar_url,
    auth.uid(), _deact, _reason,
    jsonb_build_object(
      'id_number', p.id_number,
      'full_name', p.full_name,
      'job_title', p.job_title,
      'phone', p.phone,
      'department_id', p.department_id,
      'department_name', p.dept_name,
      'avatar_url', p.avatar_url,
      'deactivated_at', _deact,
      'was_active_at_delete', p.is_active
    )
  )
  RETURNING id INTO _arch_id;

  UPDATE public.departments SET manager_id = NULL WHERE manager_id = _user_id;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;

  RETURN _arch_id;
END;
$function$;