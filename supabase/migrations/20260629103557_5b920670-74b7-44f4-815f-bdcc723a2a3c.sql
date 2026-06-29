
CREATE OR REPLACE FUNCTION public.archive_employee(_user_id uuid, _reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.has_role(auth.uid(), 'main_admin') THEN
    RAISE EXCEPTION 'רק מנהל ראשי יכול לבצע מחיקה סופית של עובד';
  END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'לא ניתן למחוק את החשבון של עצמך'; END IF;

  SELECT p2.id, p2.id_number
    INTO p
    FROM public.profiles p2
   WHERE p2.id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'עובד לא נמצא'; END IF;

  -- Free the ID number completely: remove any prior archive snapshots
  -- for either the same user or the same id_number, so the ID can be reused.
  DELETE FROM public.employee_archive
   WHERE original_id = _user_id
      OR (p.id_number IS NOT NULL AND id_number = p.id_number);

  UPDATE public.departments SET manager_id = NULL WHERE manager_id = _user_id;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;

  RETURN _user_id;
END;
$function$;
