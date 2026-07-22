-- Keep user_task_permissions aligned with the user's current role(s).
-- Platform / branch managers and department heads use role-based access only.
-- Assistant managers receive a read-only baseline that can be customized later.

CREATE OR REPLACE FUNCTION public.sync_user_task_permissions(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _roles public.app_role[];
  _branch_id uuid;
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(role ORDER BY role), ARRAY[]::public.app_role[])
    INTO _roles
  FROM public.user_roles
  WHERE user_id = _user_id;

  SELECT branch_id INTO _branch_id FROM public.profiles WHERE id = _user_id;

  DELETE FROM public.user_task_permissions WHERE user_id = _user_id;

  IF _roles && ARRAY[
    'main_admin'::public.app_role,
    'system_admin'::public.app_role,
    'branch_manager'::public.app_role
  ] THEN
    RETURN;
  END IF;

  IF 'department_manager'::public.app_role = ANY(_roles) THEN
    RETURN;
  END IF;

  IF 'assistant_manager'::public.app_role = ANY(_roles) THEN
    INSERT INTO public.user_task_permissions (
      user_id,
      branch_id,
      can_view_dashboard,
      can_view_all_employees,
      can_view_employee_details,
      can_view_schedule,
      can_view_tasks,
      updated_at
    ) VALUES (
      _user_id,
      _branch_id,
      true,
      true,
      true,
      true,
      true,
      now()
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_user_task_permissions_on_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_user_task_permissions(OLD.user_id);
    RETURN OLD;
  END IF;

  PERFORM public.sync_user_task_permissions(NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_manager_default_permissions ON public.user_roles;
DROP TRIGGER IF EXISTS trg_sync_user_task_permissions_on_role_change ON public.user_roles;

CREATE TRIGGER trg_sync_user_task_permissions_on_role_change
  AFTER INSERT OR DELETE OR UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_user_task_permissions_on_role_change();

-- Assigning a department head replaces employee/assistant/dept-head roles with one dept-head role.
CREATE OR REPLACE FUNCTION public.set_department_manager(_dept_id uuid, _new_manager_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF NOT (
    public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = auth.uid()
          AND p.can_manage_departments = true
      )
    )
  ) THEN
    RAISE EXCEPTION 'אין הרשאה לניהול מחלקות';
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
    DELETE FROM public.user_roles
    WHERE user_id = _new_manager_id
      AND role IN (
        'employee'::public.app_role,
        'assistant_manager'::public.app_role,
        'department_manager'::public.app_role
      );

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

    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _old_manager_id
    ) THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (_old_manager_id, 'employee'::public.app_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  IF _new_manager_id IS NOT NULL THEN
    PERFORM public.sync_user_task_permissions(_new_manager_id);
  END IF;

  IF _old_manager_id IS NOT NULL
     AND _old_manager_id IS DISTINCT FROM _new_manager_id THEN
    PERFORM public.sync_user_task_permissions(_old_manager_id);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_user_task_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_user_task_permissions(uuid) TO authenticated, service_role;

-- Backfill existing users so stale assistant permissions do not linger on other roles.
DO $$
DECLARE
  _uid uuid;
BEGIN
  FOR _uid IN
    SELECT DISTINCT user_id FROM public.user_roles
    UNION
    SELECT user_id FROM public.user_task_permissions
  LOOP
    PERFORM public.sync_user_task_permissions(_uid);
  END LOOP;
END;
$$;
