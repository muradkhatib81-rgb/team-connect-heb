-- Backfill departments.manager_id from department_manager role when missing.
-- Some flows assigned the role without updating departments.manager_id.

UPDATE public.departments AS dept
SET manager_id = profile.id
FROM public.profiles AS profile
JOIN public.user_roles AS role
  ON role.user_id = profile.id
 AND role.role = 'department_manager'::public.app_role
WHERE profile.department_id = dept.id
  AND dept.manager_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.departments AS other_dept
    WHERE other_dept.manager_id = profile.id
      AND other_dept.id <> dept.id
  );
