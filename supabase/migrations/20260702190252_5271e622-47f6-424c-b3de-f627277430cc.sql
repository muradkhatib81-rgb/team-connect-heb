-- Stage 4 tail-cleanup: replace legacy user-visible role labels in DB layer.
-- Internal role identifiers are untouched; only Hebrew text shown to users changes.

CREATE OR REPLACE FUNCTION public.archive_employee(_user_id uuid, _reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p record;
  _active_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'לא ניתן למחוק את החשבון של עצמך'; END IF;
  IF public.is_system_admin(_user_id) THEN RAISE EXCEPTION 'לא ניתן למחוק את בעל המערכת הראשי'; END IF;

  _active_branch_id := public.current_active_branch();
  IF _active_branch_id IS NULL THEN
    RAISE EXCEPTION 'יש לבחור סניף פעיל';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.user_task_permissions p0
        WHERE p0.user_id = auth.uid()
          AND p0.can_delete_employee = true
      )
    )
  ) THEN
    RAISE EXCEPTION 'אין הרשאה למחיקת עובד';
  END IF;

  SELECT p2.id, p2.id_number, p2.branch_id
    INTO p
    FROM public.profiles p2
   WHERE p2.id = _user_id
     AND p2.branch_id = _active_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'עובד לא נמצא בסניף הפעיל'; END IF;

  IF public.has_role(_user_id, 'main_admin'::public.app_role)
     OR public.has_role(_user_id, 'branch_manager'::public.app_role) THEN
    IF NOT public.has_role(auth.uid(), 'main_admin'::public.app_role) THEN
      RAISE EXCEPTION 'רק בעל המערכת יכול למחוק מנהל';
    END IF;
  END IF;

  DELETE FROM public.employee_archive
   WHERE branch_id = _active_branch_id
     AND (original_id = _user_id OR (p.id_number IS NOT NULL AND id_number = p.id_number));

  UPDATE public.departments SET manager_id = NULL
   WHERE manager_id = _user_id
     AND branch_id = _active_branch_id;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id AND branch_id = _active_branch_id;

  RETURN _user_id;
END;
$function$;

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

  INSERT INTO public.profile_status_log (profile_id, actor_id, is_active, note, branch_id)
  VALUES (_user_id, auth.uid(), _active, _note, _active_branch_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_single_system_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role = 'system_admin'::public.app_role THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE role = 'system_admin'::public.app_role
        AND user_id <> NEW.user_id
    ) THEN
      RAISE EXCEPTION 'כבר קיים בעל המערכת הראשי פעיל. ניתן להגדיר רק אחד.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_profiles_basic_info(user_ids uuid[])
 RETURNS TABLE(id uuid, full_name text, job_title text, role text, role_label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ranked_roles AS (
    SELECT
      ur.user_id,
      ur.role,
      CASE ur.role
        WHEN 'main_admin' THEN 1
        WHEN 'branch_manager' THEN 2
        WHEN 'assistant_manager' THEN 3
        WHEN 'department_manager' THEN 4
        WHEN 'employee' THEN 5
        ELSE 99
      END AS role_rank
    FROM public.user_roles ur
    WHERE ur.user_id = ANY(user_ids)
  ), top_roles AS (
    SELECT DISTINCT ON (user_id) user_id, role
    FROM ranked_roles
    ORDER BY user_id, role_rank
  )
  SELECT
    p.id,
    p.full_name,
    p.job_title,
    tr.role::text AS role,
    CASE tr.role::text
      WHEN 'main_admin' THEN 'בעל המערכת'
      WHEN 'branch_manager' THEN 'מנהל סניף'
      WHEN 'assistant_manager' THEN 'סגן מנהל'
      WHEN 'department_manager' THEN 'אחראי מחלקה'
      WHEN 'employee' THEN 'עובד'
      ELSE NULL
    END AS role_label
  FROM public.profiles p
  LEFT JOIN top_roles tr ON tr.user_id = p.id
  WHERE p.id = ANY(user_ids);
$function$;