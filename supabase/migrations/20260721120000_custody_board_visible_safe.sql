-- Never raise from is_custody_board_visible: UI gates must get false, not HTTP 400/500.

CREATE OR REPLACE FUNCTION public.is_custody_board_visible(
  _user_id uuid DEFAULT auth.uid(),
  _at timestamptz DEFAULT now(),
  _branch_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_branch := public.custody_resolve_branch(_user_id, _branch_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF v_branch IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_platform_owner(_user_id) THEN
    RETURN true;
  END IF;

  IF public.has_role(_user_id, 'branch_manager'::public.app_role)
     OR public.has_role(_user_id, 'assistant_manager'::public.app_role) THEN
    RETURN public.is_management_on_shift(_user_id, v_branch);
  END IF;

  RETURN public.is_user_on_work_shift(_user_id, _at);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_custody_board_visible(uuid, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_custody_board_visible(uuid, timestamptz, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
