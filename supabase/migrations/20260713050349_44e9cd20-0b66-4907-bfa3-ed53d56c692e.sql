CREATE OR REPLACE FUNCTION public.get_break_policy()
RETURNS public.break_policy
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid := public.current_active_branch();
  v_user uuid := auth.uid();
  r public.break_policy%ROWTYPE;
BEGIN
  IF v_branch IS NULL AND v_user IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM public.profiles WHERE id = v_user;
  END IF;

  IF v_branch IS NOT NULL THEN
    SELECT * INTO r
    FROM public.break_policy
    WHERE branch_id = v_branch
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    SELECT * INTO r
    FROM public.break_policy
    WHERE branch_id IS NULL
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    r.request_scope := 'employees_dept_assistant';
    r.requires_approval := true;
    r.approver_scope := 'permission_based';
    r.dispatcher_scope := 'self';
    r.branch_id := v_branch;
  END IF;

  RETURN r;
END;
$$;