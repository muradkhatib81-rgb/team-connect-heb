-- Platform Owners (main_admin / system_admin) select the active Branch via
-- X-Active-Branch (Platform → Company → Branch). current_active_branch()
-- previously honored that header only for system_admin, so main_admin
-- Platform Owners always resolved to NULL (profile.branch_id is intentionally
-- null). That broke department mutations (set_department_manager) with
-- "יש לבחור סניף פעיל לפני שינוי מחלקה" even when a Branch was selected.

CREATE OR REPLACE FUNCTION public.current_active_branch()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_header text;
  v_uuid uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_header := nullif(
      current_setting('request.headers', true)::json->>'x-active-branch',
      ''
    );
  EXCEPTION WHEN others THEN
    v_header := NULL;
  END;

  -- Platform Owners switch Branch Mode via the header (never profile.branch_id).
  IF public.is_platform_owner(v_uid) THEN
    IF v_header IS NULL THEN
      RETURN NULL;
    END IF;
    BEGIN
      v_uuid := v_header::uuid;
    EXCEPTION WHEN others THEN
      v_uuid := NULL;
    END;
    RETURN v_uuid;
  END IF;

  -- Every other role is locked to their own branch regardless of header.
  SELECT branch_id INTO v_uuid FROM public.profiles WHERE id = v_uid;
  RETURN v_uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_active_branch() TO authenticated, anon, service_role;
