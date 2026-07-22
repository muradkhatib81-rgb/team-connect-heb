-- Drop stale "management on shift" rows when a user is no longer branch/assistant manager.

CREATE OR REPLACE FUNCTION public.is_management_on_shift(
  _user_id uuid,
  _branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.management_on_shift m
    WHERE m.user_id = _user_id
      AND m.branch_id = _branch_id
      AND EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = _user_id
          AND ur.role IN (
            'branch_manager'::public.app_role,
            'assistant_manager'::public.app_role
          )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_management_on_shift()
RETURNS TABLE(
  id uuid,
  user_id uuid,
  started_at timestamptz,
  full_name text,
  avatar_url text,
  job_title text,
  role app_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.user_id,
    m.started_at,
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '')
    ) AS full_name,
    p.avatar_url,
    p.job_title,
    (
      SELECT ur.role
      FROM public.user_roles ur
      WHERE ur.user_id = m.user_id
        AND ur.role IN ('branch_manager'::public.app_role, 'assistant_manager'::public.app_role)
      ORDER BY CASE ur.role
        WHEN 'branch_manager'::public.app_role THEN 1
        WHEN 'assistant_manager'::public.app_role THEN 2
        ELSE 9
      END
      LIMIT 1
    ) AS role
  FROM public.management_on_shift m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE (public.current_active_branch() IS NULL
         OR m.branch_id = public.current_active_branch())
    AND NOT public.is_platform_owner(m.user_id)
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = m.user_id
        AND ur.role IN (
          'branch_manager'::public.app_role,
          'assistant_manager'::public.app_role
        )
    )
  ORDER BY m.started_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.clear_management_on_shift_if_not_manager(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role IN (
        'branch_manager'::public.app_role,
        'assistant_manager'::public.app_role
      )
  ) THEN
    DELETE FROM public.management_on_shift WHERE user_id = _user_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_clear_management_on_shift_on_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.clear_management_on_shift_if_not_manager(COALESCE(NEW.user_id, OLD.user_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_management_on_shift_on_role_change ON public.user_roles;
CREATE TRIGGER trg_clear_management_on_shift_on_role_change
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_clear_management_on_shift_on_role_change();

-- One-time cleanup for users already demoted while still marked on shift.
DELETE FROM public.management_on_shift m
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_roles ur
  WHERE ur.user_id = m.user_id
    AND ur.role IN (
      'branch_manager'::public.app_role,
      'assistant_manager'::public.app_role
    )
);

GRANT EXECUTE ON FUNCTION public.clear_management_on_shift_if_not_manager(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_management_on_shift() TO authenticated;
