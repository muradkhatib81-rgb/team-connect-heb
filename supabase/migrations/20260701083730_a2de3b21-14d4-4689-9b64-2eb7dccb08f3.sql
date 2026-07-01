
-- Break policy per branch (system-wide settings for the breaks module)
CREATE TABLE IF NOT EXISTS public.break_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  request_scope text NOT NULL DEFAULT 'employees_dept_assistant'
    CHECK (request_scope IN ('employees','dept_managers','employees_dept_managers','employees_dept_assistant','all')),
  requires_approval boolean NOT NULL DEFAULT true,
  approver_scope text NOT NULL DEFAULT 'permission_based'
    CHECK (approver_scope IN ('branch_manager','assistant_manager','both','permission_based')),
  dispatcher_scope text NOT NULL DEFAULT 'self'
    CHECK (dispatcher_scope IN ('self','dept_manager','assistant_manager','branch_manager','permission_based')),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);

GRANT SELECT ON public.break_policy TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.break_policy TO authenticated;
GRANT ALL ON public.break_policy TO service_role;

ALTER TABLE public.break_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "break_policy_select_all_auth" ON public.break_policy
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "break_policy_main_admin_write" ON public.break_policy
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'main_admin'))
  WITH CHECK (public.has_role(auth.uid(),'main_admin'));

CREATE POLICY "break_policy_branch_scope" ON public.break_policy AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (branch_id IS NULL OR public.current_active_branch() IS NULL OR branch_id = public.current_active_branch())
  WITH CHECK (branch_id IS NULL OR public.current_active_branch() IS NULL OR branch_id = public.current_active_branch());

CREATE TRIGGER trg_break_policy_updated
  BEFORE UPDATE ON public.break_policy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_break_policy_set_branch
  BEFORE INSERT ON public.break_policy
  FOR EACH ROW EXECUTE FUNCTION public.set_default_branch_id();

-- Resolve effective policy row for the caller's branch (fallback to defaults)
CREATE OR REPLACE FUNCTION public.get_break_policy()
RETURNS public.break_policy
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_branch uuid := public.current_active_branch();
  v_user uuid := auth.uid();
  r public.break_policy%ROWTYPE;
BEGIN
  IF v_branch IS NULL AND v_user IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM public.profiles WHERE id = v_user;
  END IF;
  SELECT * INTO r FROM public.break_policy WHERE branch_id IS NOT DISTINCT FROM v_branch LIMIT 1;
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

-- Policy-driven helpers
CREATE OR REPLACE FUNCTION public.can_request_break_by_policy(_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE p public.break_policy; is_emp bool; is_dm bool; is_am bool; is_bm bool; is_ma bool;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  p := public.get_break_policy();
  is_ma := public.has_role(_user_id,'main_admin');
  is_bm := public.has_role(_user_id,'branch_manager');
  is_am := public.has_role(_user_id,'assistant_manager');
  is_dm := public.has_role(_user_id,'department_manager');
  is_emp := NOT (is_ma OR is_bm OR is_am OR is_dm);
  IF is_ma THEN RETURN true; END IF;
  RETURN CASE p.request_scope
    WHEN 'employees' THEN is_emp
    WHEN 'dept_managers' THEN is_dm
    WHEN 'employees_dept_managers' THEN is_emp OR is_dm
    WHEN 'employees_dept_assistant' THEN is_emp OR is_dm OR is_am
    WHEN 'all' THEN true
    ELSE true
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_approve_break_by_policy(_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE p public.break_policy;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.has_role(_user_id,'main_admin') THEN RETURN true; END IF;
  p := public.get_break_policy();
  RETURN CASE p.approver_scope
    WHEN 'branch_manager' THEN public.has_role(_user_id,'branch_manager')
    WHEN 'assistant_manager' THEN public.has_role(_user_id,'assistant_manager')
    WHEN 'both' THEN public.has_role(_user_id,'branch_manager') OR public.has_role(_user_id,'assistant_manager')
    WHEN 'permission_based' THEN public.has_break_manage_perm(_user_id)
    ELSE public.has_break_manage_perm(_user_id)
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_dispatch_break_by_policy(_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE p public.break_policy;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.has_role(_user_id,'main_admin') THEN RETURN true; END IF;
  p := public.get_break_policy();
  RETURN CASE p.dispatcher_scope
    WHEN 'self' THEN true
    WHEN 'dept_manager' THEN public.has_role(_user_id,'department_manager')
    WHEN 'assistant_manager' THEN public.has_role(_user_id,'assistant_manager')
    WHEN 'branch_manager' THEN public.has_role(_user_id,'branch_manager')
    WHEN 'permission_based' THEN public.has_break_manage_perm(_user_id)
    ELSE true
  END;
END;
$$;

-- Update existing can_user_request_break: combine job-title flag + policy
CREATE OR REPLACE FUNCTION public.can_user_request_break(_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_title_ok boolean;
BEGIN
  v_title_ok := COALESCE((
    SELECT jt.can_request_break
    FROM public.profiles p
    JOIN public.job_titles jt ON lower(btrim(jt.name)) = lower(btrim(p.job_title))
    WHERE p.id = _user_id
      AND p.job_title IS NOT NULL AND btrim(p.job_title) <> ''
    LIMIT 1
  ), true);
  RETURN v_title_ok
     AND public.can_request_break_by_policy(_user_id)
     AND public.can_dispatch_break_by_policy(_user_id);
END;
$$;

-- Auto-approve trigger when policy.requires_approval = false
CREATE OR REPLACE FUNCTION public.break_requests_apply_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p public.break_policy;
BEGIN
  p := public.get_break_policy();
  IF NEW.status = 'pending' AND p.requires_approval = false THEN
    NEW.status := 'approved';
    NEW.approved_at_time := COALESCE(NEW.approved_at_time, NEW.requested_at, now());
    NEW.approved_by := COALESCE(NEW.approved_by, NEW.user_id);
    NEW.approval_decided_at := COALESCE(NEW.approval_decided_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_break_requests_apply_policy ON public.break_requests;
CREATE TRIGGER trg_break_requests_apply_policy
  BEFORE INSERT ON public.break_requests
  FOR EACH ROW EXECUTE FUNCTION public.break_requests_apply_policy();

-- Enforce approver scope in RLS UPDATE: keep existing branch scope + require approver policy
DROP POLICY IF EXISTS "Break managers update all" ON public.break_requests;
CREATE POLICY "Break managers update all" ON public.break_requests
  FOR UPDATE TO authenticated
  USING (public.has_break_manage_perm(auth.uid()) AND public.can_approve_break_by_policy(auth.uid()))
  WITH CHECK (public.has_break_manage_perm(auth.uid()) AND public.can_approve_break_by_policy(auth.uid()));
