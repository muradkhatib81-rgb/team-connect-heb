CREATE OR REPLACE FUNCTION public.set_employee_active(_user_id uuid, _active boolean, _note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p record;
  _active_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF _user_id = auth.uid() AND _active = false THEN RAISE EXCEPTION 'לא ניתן להשבית את החשבון של עצמך'; END IF;
  IF public.is_system_admin(_user_id) AND _active = false THEN RAISE EXCEPTION 'לא ניתן להשבית את בעל המערכת הראשי'; END IF;

  _active_branch_id := public.current_active_branch();
  IF _active_branch_id IS NULL THEN RAISE EXCEPTION 'יש לבחור סניף פעיל'; END IF;

  IF NOT (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.user_task_permissions p0
        WHERE p0.user_id = auth.uid()
          AND (p0.can_edit_employee = true OR p0.can_delete_employee = true)
      )
    )
  ) THEN
    RAISE EXCEPTION 'אין הרשאה לעדכון סטטוס עובד';
  END IF;

  SELECT id, branch_id INTO p
  FROM public.profiles
  WHERE id = _user_id
    AND branch_id = _active_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'עובד לא נמצא בסניף הפעיל'; END IF;

  UPDATE public.profiles
     SET is_active = _active,
         deactivated_at = CASE WHEN _active THEN NULL ELSE now() END
   WHERE id = _user_id
     AND branch_id = _active_branch_id;

  INSERT INTO public.profile_status_log (profile_id, actor_id, action, note, branch_id)
  VALUES (
    _user_id,
    auth.uid(),
    CASE WHEN _active THEN 'activated' ELSE 'deactivated' END,
    _note,
    _active_branch_id
  );
END;
$function$;