-- Department branch-scope hardening for System Administrator active-branch writes

-- The previous static branch default was applied before the branch trigger ran,
-- so an INSERT that omitted branch_id could receive the original seeded branch
-- instead of the selected active branch. Department creation now must resolve
-- through the active branch trigger / explicit server value.
ALTER TABLE public.departments
  ALTER COLUMN branch_id DROP DEFAULT;

DROP POLICY IF EXISTS "Admins can insert departments" ON public.departments;
DROP POLICY IF EXISTS "Admins can update departments" ON public.departments;
DROP POLICY IF EXISTS "Admins can delete departments" ON public.departments;

CREATE POLICY "Admins can insert departments" ON public.departments
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'main_admin'::public.app_role) OR public.is_system_admin(auth.uid()))
    AND branch_id IS NOT NULL
    AND public.current_active_branch() IS NOT NULL
    AND branch_id = public.current_active_branch()
  );

CREATE POLICY "Admins can update departments" ON public.departments
  FOR UPDATE TO authenticated
  USING (
    (public.has_role(auth.uid(), 'main_admin'::public.app_role) OR public.is_system_admin(auth.uid()))
    AND branch_id IS NOT NULL
    AND public.current_active_branch() IS NOT NULL
    AND branch_id = public.current_active_branch()
  )
  WITH CHECK (
    (public.has_role(auth.uid(), 'main_admin'::public.app_role) OR public.is_system_admin(auth.uid()))
    AND branch_id IS NOT NULL
    AND public.current_active_branch() IS NOT NULL
    AND branch_id = public.current_active_branch()
  );

CREATE POLICY "Admins can delete departments" ON public.departments
  FOR DELETE TO authenticated
  USING (
    (public.has_role(auth.uid(), 'main_admin'::public.app_role) OR public.is_system_admin(auth.uid()))
    AND branch_id IS NOT NULL
    AND public.current_active_branch() IS NOT NULL
    AND branch_id = public.current_active_branch()
  );

-- Keep the manager-assignment RPC privileged, but explicitly enforce the
-- same active-branch boundary because SECURITY DEFINER functions do not rely
-- on table RLS for their internal writes.
CREATE OR REPLACE FUNCTION public.set_department_manager(_dept_id uuid, _new_manager_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _old_manager_id uuid;
  _dept_branch_id uuid;
  _manager_branch_id uuid;
  _manager_active boolean;
  _active_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'לא מחובר';
  END IF;

  IF NOT (public.has_role(auth.uid(), 'main_admin'::public.app_role) OR public.is_system_admin(auth.uid())) THEN
    RAISE EXCEPTION 'רק מנהל ראשי יכול לבצע פעולה זו';
  END IF;

  _active_branch_id := public.current_active_branch();
  IF _active_branch_id IS NULL THEN
    RAISE EXCEPTION 'יש לבחור סניף פעיל לפני שינוי מחלקה';
  END IF;

  SELECT manager_id, branch_id
    INTO _old_manager_id, _dept_branch_id
  FROM public.departments
  WHERE id = _dept_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'מחלקה לא נמצאה';
  END IF;

  IF _dept_branch_id IS DISTINCT FROM _active_branch_id THEN
    RAISE EXCEPTION 'מחלקה לא נמצאה בסניף הפעיל';
  END IF;

  IF _new_manager_id IS NOT NULL THEN
    SELECT branch_id, COALESCE(is_active, true)
      INTO _manager_branch_id, _manager_active
    FROM public.profiles
    WHERE id = _new_manager_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'מנהל מחלקה לא נמצא';
    END IF;

    IF _manager_branch_id IS DISTINCT FROM _dept_branch_id THEN
      RAISE EXCEPTION 'ניתן לשייך מנהל רק מאותו סניף';
    END IF;

    IF _manager_active IS NOT TRUE THEN
      RAISE EXCEPTION 'לא ניתן לשייך עובד לא פעיל כמנהל מחלקה';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.departments
      WHERE manager_id = _new_manager_id
        AND id <> _dept_id
        AND branch_id = _dept_branch_id
    ) THEN
      RAISE EXCEPTION 'העובד כבר משמש כאחראי של מחלקה אחרת';
    END IF;
  END IF;

  IF _old_manager_id IS NOT DISTINCT FROM _new_manager_id THEN
    RETURN;
  END IF;

  UPDATE public.departments
  SET manager_id = _new_manager_id
  WHERE id = _dept_id
    AND branch_id = _active_branch_id;

  IF _new_manager_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_new_manager_id, 'department_manager'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  IF _old_manager_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.departments
       WHERE manager_id = _old_manager_id
         AND id <> _dept_id
     ) THEN
    DELETE FROM public.user_roles
    WHERE user_id = _old_manager_id
      AND role = 'department_manager'::public.app_role;
  END IF;
END;
$function$;