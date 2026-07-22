-- Users promoted from assistant manager to department head must not keep both roles.

DELETE FROM public.user_roles ur
WHERE ur.role = 'assistant_manager'::public.app_role
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur2
    WHERE ur2.user_id = ur.user_id
      AND ur2.role = 'department_manager'::public.app_role
  );

DO $$
DECLARE
  _uid uuid;
BEGIN
  FOR _uid IN
    SELECT DISTINCT user_id
    FROM public.user_roles
    WHERE role = 'department_manager'::public.app_role
  LOOP
    PERFORM public.sync_user_task_permissions(_uid);
  END LOOP;
END;
$$;
