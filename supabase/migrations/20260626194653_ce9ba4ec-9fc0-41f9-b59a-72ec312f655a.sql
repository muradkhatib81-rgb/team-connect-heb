
CREATE OR REPLACE FUNCTION public.set_department_manager(
  _dept_id uuid,
  _new_manager_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_manager_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'main_admin') THEN
    RAISE EXCEPTION 'רק מנהל ראשי יכול לבצע פעולה זו';
  END IF;

  SELECT manager_id INTO _old_manager_id
  FROM public.departments
  WHERE id = _dept_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'מחלקה לא נמצאה';
  END IF;

  IF _old_manager_id IS NOT DISTINCT FROM _new_manager_id THEN
    RETURN;
  END IF;

  -- Prevent assigning an employee who already manages another department.
  IF _new_manager_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.departments
       WHERE manager_id = _new_manager_id AND id <> _dept_id
     ) THEN
    RAISE EXCEPTION 'העובד כבר משמש כאחראי של מחלקה אחרת';
  END IF;

  UPDATE public.departments
  SET manager_id = _new_manager_id
  WHERE id = _dept_id;

  IF _new_manager_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_new_manager_id, 'department_manager')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  IF _old_manager_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.departments
       WHERE manager_id = _old_manager_id AND id <> _dept_id
     ) THEN
    DELETE FROM public.user_roles
    WHERE user_id = _old_manager_id AND role = 'department_manager';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_department_manager(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_department_manager(uuid, uuid) TO authenticated, service_role;
