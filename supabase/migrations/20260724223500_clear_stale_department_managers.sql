-- Remove stale department-manager links where the manager's current profile
-- belongs to another department. This repairs old transfers only; it does not
-- modify user roles, permissions, or profile department assignments.

UPDATE public.departments AS d
SET manager_id = NULL
WHERE d.manager_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = d.manager_id
      AND p.department_id = d.id
      AND p.branch_id = d.branch_id
  );
