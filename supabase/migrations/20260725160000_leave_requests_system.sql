-- Leave requests system (חופשות).
-- Does not change existing roles or permission columns.
-- Uses existing user_task_permissions leave toggles:
--   can_view_leave, can_approve_leave, can_reject_leave, can_edit_leave_balance
-- Manual profile on_leave path remains valid; this adds request workflow + balances.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.leave_request_kind AS ENUM ('leave', 'cancellation');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.leave_request_status AS ENUM (
    'pending_dept',
    'pending_admin',
    'approved',
    'rejected',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- leave_types (regular / sick per branch)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code IN ('regular', 'sick')),
  name text NOT NULL,
  requires_attachment boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);

CREATE TABLE IF NOT EXISTS public.leave_accrual_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
  days_per_month numeric(6,2) NOT NULL DEFAULT 0 CHECK (days_per_month >= 0),
  max_cap numeric(8,2),
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, leave_type_id)
);

CREATE TABLE IF NOT EXISTS public.leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
  manual_balance numeric(8,2) NOT NULL DEFAULT 0,
  accrued_days numeric(8,2) NOT NULL DEFAULT 0,
  used_days numeric(8,2) NOT NULL DEFAULT 0,
  reserved_days numeric(8,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, leave_type_id)
);

CREATE TABLE IF NOT EXISTS public.leave_balance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
  delta numeric(8,2) NOT NULL,
  reason text,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE RESTRICT,
  kind public.leave_request_kind NOT NULL DEFAULT 'leave',
  status public.leave_request_status NOT NULL DEFAULT 'pending_dept',
  start_date date NOT NULL,
  end_date date NOT NULL,
  days_count numeric(6,2) NOT NULL CHECK (days_count > 0),
  note text,
  cancels_request_id uuid REFERENCES public.leave_requests(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  dept_decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  dept_decided_at timestamptz,
  dept_note text,
  admin_decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  admin_decided_at timestamptz,
  admin_note text,
  balance_warning boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.leave_request_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  file_size integer,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.leave_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  request_id uuid REFERENCES public.leave_requests(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_branch_status ON public.leave_requests(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON public.leave_requests(user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dept ON public.leave_requests(department_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_balances_user ON public.leave_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_audit_branch ON public.leave_audit_log(branch_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Grants + RLS
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_accrual_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_balances TO authenticated;
GRANT SELECT, INSERT ON public.leave_balance_adjustments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.leave_requests TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.leave_request_attachments TO authenticated;
GRANT SELECT, INSERT ON public.leave_audit_log TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_accrual_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_request_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_audit_log ENABLE ROW LEVEL SECURITY;

-- Helper: leave admin permission (view/approve/reject/balance)
CREATE OR REPLACE FUNCTION public.has_leave_perm(_user_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'system_admin'::public.app_role)
    OR public.has_role(_user_id, 'main_admin'::public.app_role)
    OR public.has_role(_user_id, 'branch_manager'::public.app_role)
    OR (
      public.has_role(_user_id, 'assistant_manager'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.user_task_permissions p
        WHERE p.user_id = _user_id
          AND (
            (_perm = 'view' AND (p.can_view_leave OR p.can_approve_leave OR p.can_reject_leave OR p.can_edit_leave_balance))
            OR (_perm = 'approve' AND p.can_approve_leave)
            OR (_perm = 'reject' AND p.can_reject_leave)
            OR (_perm = 'balance' AND p.can_edit_leave_balance)
          )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.is_dept_manager_of(_user_id uuid, _department_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = _department_id AND d.manager_id = _user_id
  );
$$;

-- Restrictive branch scope on all leave tables
CREATE POLICY leave_types_branch_scope ON public.leave_types AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (branch_id = public.current_active_branch())
  WITH CHECK (branch_id = public.current_active_branch());

CREATE POLICY leave_accrual_branch_scope ON public.leave_accrual_rules AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (branch_id = public.current_active_branch())
  WITH CHECK (branch_id = public.current_active_branch());

CREATE POLICY leave_balances_branch_scope ON public.leave_balances AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (branch_id = public.current_active_branch())
  WITH CHECK (branch_id = public.current_active_branch());

CREATE POLICY leave_adj_branch_scope ON public.leave_balance_adjustments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (branch_id = public.current_active_branch())
  WITH CHECK (branch_id = public.current_active_branch());

CREATE POLICY leave_requests_branch_scope ON public.leave_requests AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (branch_id = public.current_active_branch())
  WITH CHECK (branch_id = public.current_active_branch());

CREATE POLICY leave_attach_branch_scope ON public.leave_request_attachments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (branch_id = public.current_active_branch())
  WITH CHECK (branch_id = public.current_active_branch());

CREATE POLICY leave_audit_branch_scope ON public.leave_audit_log AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (branch_id IS NULL OR branch_id = public.current_active_branch())
  WITH CHECK (branch_id IS NULL OR branch_id = public.current_active_branch());

-- leave_types
CREATE POLICY leave_types_select ON public.leave_types FOR SELECT TO authenticated USING (true);
CREATE POLICY leave_types_write ON public.leave_types FOR ALL TO authenticated
  USING (public.has_leave_perm(auth.uid(), 'balance'))
  WITH CHECK (public.has_leave_perm(auth.uid(), 'balance'));

-- accrual rules
CREATE POLICY leave_accrual_select ON public.leave_accrual_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY leave_accrual_write ON public.leave_accrual_rules FOR ALL TO authenticated
  USING (public.has_leave_perm(auth.uid(), 'balance'))
  WITH CHECK (public.has_leave_perm(auth.uid(), 'balance'));

-- balances: own row OR leave viewer/manager
CREATE POLICY leave_balances_select ON public.leave_balances FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_leave_perm(auth.uid(), 'view')
    OR public.has_leave_perm(auth.uid(), 'balance')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.departments d ON d.id = p.department_id
      WHERE p.id = leave_balances.user_id AND d.manager_id = auth.uid()
    )
  );
CREATE POLICY leave_balances_write ON public.leave_balances FOR ALL TO authenticated
  USING (public.has_leave_perm(auth.uid(), 'balance'))
  WITH CHECK (public.has_leave_perm(auth.uid(), 'balance'));

CREATE POLICY leave_adj_select ON public.leave_balance_adjustments FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_leave_perm(auth.uid(), 'view')
    OR public.has_leave_perm(auth.uid(), 'balance')
  );
CREATE POLICY leave_adj_insert ON public.leave_balance_adjustments FOR INSERT TO authenticated
  WITH CHECK (public.has_leave_perm(auth.uid(), 'balance'));

-- requests
CREATE POLICY leave_requests_select ON public.leave_requests FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_leave_perm(auth.uid(), 'view')
    OR public.has_leave_perm(auth.uid(), 'approve')
    OR public.has_leave_perm(auth.uid(), 'reject')
    OR public.is_dept_manager_of(auth.uid(), department_id)
  );
CREATE POLICY leave_requests_insert ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY leave_requests_update ON public.leave_requests FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_leave_perm(auth.uid(), 'approve')
    OR public.has_leave_perm(auth.uid(), 'reject')
    OR public.is_dept_manager_of(auth.uid(), department_id)
  );

CREATE POLICY leave_attach_select ON public.leave_request_attachments FOR SELECT TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.leave_requests r
      WHERE r.id = request_id
        AND (
          r.user_id = auth.uid()
          OR public.has_leave_perm(auth.uid(), 'view')
          OR public.has_leave_perm(auth.uid(), 'approve')
          OR public.is_dept_manager_of(auth.uid(), r.department_id)
        )
    )
  );
CREATE POLICY leave_attach_insert ON public.leave_request_attachments FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY leave_audit_select ON public.leave_audit_log FOR SELECT TO authenticated
  USING (
    actor_id = auth.uid()
    OR user_id = auth.uid()
    OR public.has_leave_perm(auth.uid(), 'view')
  );
CREATE POLICY leave_audit_insert ON public.leave_audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() OR public.has_leave_perm(auth.uid(), 'approve') OR public.has_leave_perm(auth.uid(), 'balance'));

-- ---------------------------------------------------------------------------
-- Storage bucket for leave medical attachments
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
SELECT 'leave-attachments', 'leave-attachments', false
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'leave-attachments');

DROP POLICY IF EXISTS leave_attachments_storage_select ON storage.objects;
DROP POLICY IF EXISTS leave_attachments_storage_insert ON storage.objects;
DROP POLICY IF EXISTS leave_attachments_storage_delete ON storage.objects;

CREATE POLICY leave_attachments_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'leave-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY leave_attachments_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'leave-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY leave_attachments_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'leave-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Seed helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_leave_types_for_branch(_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_regular uuid;
  v_sick uuid;
BEGIN
  IF _branch_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.leave_types (branch_id, code, name, requires_attachment)
  VALUES (_branch_id, 'regular', 'חופשה רגילה', false)
  ON CONFLICT (branch_id, code) DO NOTHING;

  INSERT INTO public.leave_types (branch_id, code, name, requires_attachment)
  VALUES (_branch_id, 'sick', 'חופשת מחלה', true)
  ON CONFLICT (branch_id, code) DO NOTHING;

  SELECT id INTO v_regular FROM public.leave_types WHERE branch_id = _branch_id AND code = 'regular';
  SELECT id INTO v_sick FROM public.leave_types WHERE branch_id = _branch_id AND code = 'sick';

  INSERT INTO public.leave_accrual_rules (branch_id, leave_type_id, days_per_month, is_active)
  VALUES (_branch_id, v_regular, 1.5, true)
  ON CONFLICT (branch_id, leave_type_id) DO NOTHING;

  INSERT INTO public.leave_accrual_rules (branch_id, leave_type_id, days_per_month, is_active)
  VALUES (_branch_id, v_sick, 1.0, true)
  ON CONFLICT (branch_id, leave_type_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.write_leave_audit(
  _action text,
  _request_id uuid DEFAULT NULL,
  _user_id uuid DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb,
  _branch_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.leave_audit_log (branch_id, request_id, user_id, actor_id, action, payload)
  VALUES (
    COALESCE(_branch_id, public.current_active_branch()),
    _request_id,
    _user_id,
    auth.uid(),
    _action,
    COALESCE(_payload, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_leave_balance(_user_id uuid, _leave_type_id uuid, _branch_id uuid)
RETURNS public.leave_balances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.leave_balances;
BEGIN
  INSERT INTO public.leave_balances (user_id, branch_id, leave_type_id)
  VALUES (_user_id, _branch_id, _leave_type_id)
  ON CONFLICT (user_id, leave_type_id) DO NOTHING;

  SELECT * INTO r FROM public.leave_balances
  WHERE user_id = _user_id AND leave_type_id = _leave_type_id;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_available_days(_user_id uuid, _leave_type_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(manual_balance, 0) + COALESCE(accrued_days, 0)
       - COALESCE(used_days, 0) - COALESCE(reserved_days, 0)
  FROM public.leave_balances
  WHERE user_id = _user_id AND leave_type_id = _leave_type_id;
$$;

-- Count weekdays between dates (inclusive), simple business-day approx
CREATE OR REPLACE FUNCTION public.leave_count_days(_start date, _end date)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(1, (_end - _start) + 1)::numeric;
$$;

-- ---------------------------------------------------------------------------
-- Submit leave request
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_leave_request(
  _leave_type_id uuid,
  _start_date date,
  _end_date date,
  _note text DEFAULT NULL,
  _kind public.leave_request_kind DEFAULT 'leave',
  _cancels_request_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch uuid := public.current_active_branch();
  v_dept uuid;
  v_dept_manager uuid;
  v_days numeric;
  v_available numeric;
  v_warning boolean := false;
  v_status public.leave_request_status;
  v_id uuid;
  v_is_mgmt boolean;
  v_has_dept_approver boolean := false;
  v_type public.leave_types%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF v_branch IS NULL THEN
    SELECT branch_id INTO v_branch FROM public.profiles WHERE id = v_actor;
  END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'יש לבחור סניף פעיל'; END IF;

  PERFORM public.ensure_leave_types_for_branch(v_branch);

  SELECT * INTO v_type FROM public.leave_types WHERE id = _leave_type_id AND branch_id = v_branch AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'סוג חופשה לא תקין'; END IF;

  IF _end_date < _start_date THEN RAISE EXCEPTION 'תאריך סיום חייב להיות אחרי תאריך התחלה'; END IF;
  IF _start_date < CURRENT_DATE THEN RAISE EXCEPTION 'לא ניתן לבקש חופשה לתאריך שעבר'; END IF;
  IF _start_date > CURRENT_DATE + 30 THEN
    RAISE EXCEPTION 'ניתן לבקש חופשה עד 30 יום מהיום בלבד';
  END IF;

  SELECT department_id INTO v_dept FROM public.profiles WHERE id = v_actor;
  v_days := public.leave_count_days(_start_date, _end_date);

  -- Overlap check for leave requests
  IF _kind = 'leave' AND EXISTS (
    SELECT 1 FROM public.leave_requests r
    WHERE r.user_id = v_actor
      AND r.kind = 'leave'
      AND r.status IN ('pending_dept', 'pending_admin', 'approved')
      AND daterange(r.start_date, r.end_date, '[]') && daterange(_start_date, _end_date, '[]')
  ) THEN
    RAISE EXCEPTION 'קיימת בקשה או חופשה חופפת לתאריכים אלה';
  END IF;

  PERFORM public.ensure_leave_balance(v_actor, _leave_type_id, v_branch);
  v_available := COALESCE(public.leave_available_days(v_actor, _leave_type_id), 0);
  IF v_available < v_days THEN
    v_warning := true;
  END IF;

  v_is_mgmt := public.has_role(v_actor, 'branch_manager'::public.app_role)
            OR public.has_role(v_actor, 'assistant_manager'::public.app_role)
            OR public.has_role(v_actor, 'main_admin'::public.app_role)
            OR public.has_role(v_actor, 'system_admin'::public.app_role);

  -- Dept stage only when a different department head exists; otherwise admin
  IF v_dept IS NOT NULL THEN
    SELECT d.manager_id INTO v_dept_manager
    FROM public.departments d
    WHERE d.id = v_dept;
    v_has_dept_approver := v_dept_manager IS NOT NULL AND v_dept_manager <> v_actor;
  END IF;

  IF v_is_mgmt OR NOT v_has_dept_approver THEN
    v_status := 'pending_admin';
  ELSE
    v_status := 'pending_dept';
  END IF;

  INSERT INTO public.leave_requests (
    user_id, branch_id, department_id, leave_type_id, kind, status,
    start_date, end_date, days_count, note, cancels_request_id, balance_warning
  ) VALUES (
    v_actor, v_branch, v_dept, _leave_type_id, _kind, v_status,
    _start_date, _end_date, v_days, NULLIF(trim(_note), ''), _cancels_request_id, v_warning
  ) RETURNING id INTO v_id;

  IF _kind = 'leave' THEN
    UPDATE public.leave_balances
       SET reserved_days = reserved_days + v_days, updated_at = now()
     WHERE user_id = v_actor AND leave_type_id = _leave_type_id;
  END IF;

  PERFORM public.write_leave_audit(
    'submitted', v_id, v_actor,
    jsonb_build_object(
      'kind', _kind::text,
      'start_date', _start_date,
      'end_date', _end_date,
      'days_count', v_days,
      'balance_warning', v_warning,
      'status', v_status::text
    ),
    v_branch
  );

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Dept approve / reject
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_leave_dept(
  _id uuid,
  _approve boolean,
  _note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.leave_requests%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO r FROM public.leave_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;
  IF r.status <> 'pending_dept' THEN RAISE EXCEPTION 'הבקשה אינה ממתינה לאישור אחראי מחלקה'; END IF;
  IF r.user_id = v_actor THEN RAISE EXCEPTION 'לא ניתן לאשר את הבקשה של עצמך'; END IF;
  IF NOT public.is_dept_manager_of(v_actor, r.department_id) THEN
    RAISE EXCEPTION 'אין הרשאה לאשר בקשות במחלקה זו';
  END IF;

  IF _approve THEN
    UPDATE public.leave_requests SET
      status = 'pending_admin',
      dept_decided_by = v_actor,
      dept_decided_at = now(),
      dept_note = NULLIF(trim(_note), ''),
      updated_at = now()
    WHERE id = _id;
    PERFORM public.write_leave_audit('dept_approved', _id, r.user_id,
      jsonb_build_object('note', _note), r.branch_id);
  ELSE
    UPDATE public.leave_requests SET
      status = 'rejected',
      dept_decided_by = v_actor,
      dept_decided_at = now(),
      dept_note = NULLIF(trim(_note), ''),
      updated_at = now()
    WHERE id = _id;

    IF r.kind = 'leave' THEN
      UPDATE public.leave_balances
         SET reserved_days = GREATEST(0, reserved_days - r.days_count), updated_at = now()
       WHERE user_id = r.user_id AND leave_type_id = r.leave_type_id;
    END IF;

    PERFORM public.write_leave_audit('dept_rejected', _id, r.user_id,
      jsonb_build_object('note', _note), r.branch_id);
  END IF;
END;
$$;

-- Mark existing schedule cells as חופש for an approved leave range
CREATE OR REPLACE FUNCTION public.apply_leave_to_schedule_shifts(
  _user_id uuid,
  _start date,
  _end date,
  _branch_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.schedule_shifts
     SET shift = 'off',
         start_time = NULL,
         end_time = NULL
   WHERE employee_id = _user_id
     AND branch_id = _branch_id
     AND day_date >= _start
     AND day_date <= _end;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Admin approve / reject (final)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_leave_admin(
  _id uuid,
  _approve boolean,
  _note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.leave_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_source public.leave_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;

  SELECT * INTO r FROM public.leave_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'בקשה לא נמצאה'; END IF;
  IF r.status <> 'pending_admin' THEN RAISE EXCEPTION 'הבקשה אינה ממתינה לאישור הנהלה'; END IF;
  IF r.user_id = v_actor THEN RAISE EXCEPTION 'לא ניתן לאשר את הבקשה של עצמך'; END IF;

  IF _approve THEN
    IF NOT public.has_leave_perm(v_actor, 'approve') THEN
      RAISE EXCEPTION 'אין הרשאה לאשר חופשות';
    END IF;
  ELSE
    IF NOT public.has_leave_perm(v_actor, 'reject') THEN
      RAISE EXCEPTION 'אין הרשאה לדחות חופשות';
    END IF;
  END IF;

  IF NOT _approve THEN
    UPDATE public.leave_requests SET
      status = 'rejected',
      admin_decided_by = v_actor,
      admin_decided_at = now(),
      admin_note = NULLIF(trim(_note), ''),
      updated_at = now()
    WHERE id = _id;

    IF r.kind = 'leave' THEN
      UPDATE public.leave_balances
         SET reserved_days = GREATEST(0, reserved_days - r.days_count), updated_at = now()
       WHERE user_id = r.user_id AND leave_type_id = r.leave_type_id;
    END IF;

    PERFORM public.write_leave_audit('admin_rejected', _id, r.user_id,
      jsonb_build_object('note', _note), r.branch_id);
    RETURN;
  END IF;

  -- Approve
  UPDATE public.leave_requests SET
    status = 'approved',
    admin_decided_by = v_actor,
    admin_decided_at = now(),
    admin_note = NULLIF(trim(_note), ''),
    updated_at = now()
  WHERE id = _id;

  IF r.kind = 'leave' THEN
    UPDATE public.leave_balances SET
      reserved_days = GREATEST(0, reserved_days - r.days_count),
      used_days = used_days + r.days_count,
      updated_at = now()
    WHERE user_id = r.user_id AND leave_type_id = r.leave_type_id;

    -- Apply profile leave if range includes today or future
    UPDATE public.profiles SET
      on_leave = true,
      leave_start_date = r.start_date,
      leave_end_date = r.end_date
    WHERE id = r.user_id;

    PERFORM public.apply_leave_to_schedule_shifts(
      r.user_id, r.start_date, r.end_date, r.branch_id
    );

    PERFORM public.write_leave_audit('admin_approved', _id, r.user_id,
      jsonb_build_object('note', _note, 'applied_to_profile', true), r.branch_id);
  ELSE
    -- Cancellation of an approved leave
    IF r.cancels_request_id IS NOT NULL THEN
      SELECT * INTO v_source FROM public.leave_requests WHERE id = r.cancels_request_id;
      IF FOUND AND v_source.status = 'approved' THEN
        UPDATE public.leave_requests SET status = 'cancelled', updated_at = now()
         WHERE id = v_source.id;

        UPDATE public.leave_balances SET
          used_days = GREATEST(0, used_days - v_source.days_count),
          updated_at = now()
        WHERE user_id = v_source.user_id AND leave_type_id = v_source.leave_type_id;

        UPDATE public.profiles SET
          on_leave = false,
          leave_start_date = NULL,
          leave_end_date = NULL
        WHERE id = v_source.user_id
          AND leave_start_date IS NOT DISTINCT FROM v_source.start_date
          AND leave_end_date IS NOT DISTINCT FROM v_source.end_date;
      END IF;
    END IF;

    PERFORM public.write_leave_audit('cancellation_approved', _id, r.user_id,
      jsonb_build_object('note', _note, 'cancels_request_id', r.cancels_request_id), r.branch_id);
  END IF;
END;
$$;

-- Manual cancel by admin (no request flow)
CREATE OR REPLACE FUNCTION public.admin_cancel_active_leave(
  _user_id uuid,
  _note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch uuid := public.current_active_branch();
  r public.leave_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.has_leave_perm(v_actor, 'approve') THEN
    RAISE EXCEPTION 'אין הרשאה לביטול חופשה';
  END IF;

  UPDATE public.profiles SET
    on_leave = false,
    leave_start_date = NULL,
    leave_end_date = NULL
  WHERE id = _user_id;

  FOR r IN
    SELECT * FROM public.leave_requests
    WHERE user_id = _user_id
      AND kind = 'leave'
      AND status = 'approved'
      AND end_date >= CURRENT_DATE
  LOOP
    UPDATE public.leave_requests SET status = 'cancelled', updated_at = now() WHERE id = r.id;
    UPDATE public.leave_balances SET
      used_days = GREATEST(0, used_days - r.days_count),
      updated_at = now()
    WHERE user_id = r.user_id AND leave_type_id = r.leave_type_id;
  END LOOP;

  PERFORM public.write_leave_audit(
    'manual_cancel', NULL, _user_id,
    jsonb_build_object('note', _note), v_branch
  );
END;
$$;

-- Adjust balance (manual fill)
CREATE OR REPLACE FUNCTION public.adjust_leave_balance(
  _user_id uuid,
  _leave_type_id uuid,
  _delta numeric,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch uuid := public.current_active_branch();
  r public.leave_balances;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.has_leave_perm(v_actor, 'balance') THEN
    RAISE EXCEPTION 'אין הרשאה לעריכת יתרת חופשה';
  END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'יש לבחור סניף פעיל'; END IF;

  PERFORM public.ensure_leave_types_for_branch(v_branch);
  r := public.ensure_leave_balance(_user_id, _leave_type_id, v_branch);

  UPDATE public.leave_balances SET
    manual_balance = manual_balance + _delta,
    updated_at = now()
  WHERE id = r.id;

  INSERT INTO public.leave_balance_adjustments (user_id, branch_id, leave_type_id, delta, reason, actor_id)
  VALUES (_user_id, v_branch, _leave_type_id, _delta, NULLIF(trim(_reason), ''), v_actor);

  PERFORM public.write_leave_audit(
    'balance_adjusted', NULL, _user_id,
    jsonb_build_object('leave_type_id', _leave_type_id, 'delta', _delta, 'reason', _reason),
    v_branch
  );
END;
$$;

-- Set accrual rule
CREATE OR REPLACE FUNCTION public.set_leave_accrual_rule(
  _leave_type_id uuid,
  _days_per_month numeric,
  _max_cap numeric DEFAULT NULL,
  _is_active boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch uuid := public.current_active_branch();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.has_leave_perm(v_actor, 'balance') THEN
    RAISE EXCEPTION 'אין הרשאה לעריכת כללי צבירה';
  END IF;
  IF _days_per_month < 0 THEN RAISE EXCEPTION 'ערך לא תקין'; END IF;

  INSERT INTO public.leave_accrual_rules (branch_id, leave_type_id, days_per_month, max_cap, is_active, updated_by)
  VALUES (v_branch, _leave_type_id, _days_per_month, _max_cap, _is_active, v_actor)
  ON CONFLICT (branch_id, leave_type_id) DO UPDATE SET
    days_per_month = EXCLUDED.days_per_month,
    max_cap = EXCLUDED.max_cap,
    is_active = EXCLUDED.is_active,
    updated_by = v_actor,
    updated_at = now();

  PERFORM public.write_leave_audit(
    'accrual_rule_updated', NULL, NULL,
    jsonb_build_object(
      'leave_type_id', _leave_type_id,
      'days_per_month', _days_per_month,
      'max_cap', _max_cap,
      'is_active', _is_active
    ),
    v_branch
  );
END;
$$;

-- Monthly accrual (callable by cron or admin)
CREATE OR REPLACE FUNCTION public.accrue_monthly_leave(_branch_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  rec record;
  bal public.leave_balances;
  v_new numeric;
BEGIN
  FOR rec IN
    SELECT ar.branch_id, ar.leave_type_id, ar.days_per_month, ar.max_cap, p.id AS user_id
    FROM public.leave_accrual_rules ar
    JOIN public.profiles p ON p.branch_id = ar.branch_id
    WHERE ar.is_active
      AND ar.days_per_month > 0
      AND p.is_active IS DISTINCT FROM false
      AND (_branch_id IS NULL OR ar.branch_id = _branch_id)
  LOOP
    bal := public.ensure_leave_balance(rec.user_id, rec.leave_type_id, rec.branch_id);
    v_new := bal.accrued_days + rec.days_per_month;
    IF rec.max_cap IS NOT NULL THEN
      v_new := LEAST(v_new, rec.max_cap);
    END IF;
    IF v_new <> bal.accrued_days THEN
      UPDATE public.leave_balances SET accrued_days = v_new, updated_at = now() WHERE id = bal.id;
      INSERT INTO public.leave_balance_adjustments (user_id, branch_id, leave_type_id, delta, reason, actor_id)
      VALUES (rec.user_id, rec.branch_id, rec.leave_type_id, v_new - bal.accrued_days, 'צבירה חודשית אוטומטית', NULL);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Seed types for all existing branches
DO $$
DECLARE b uuid;
BEGIN
  FOR b IN SELECT id FROM public.branches LOOP
    PERFORM public.ensure_leave_types_for_branch(b);
  END LOOP;
END $$;

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'leave_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_requests;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.submit_leave_request(uuid, date, date, text, public.leave_request_kind, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_leave_dept(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_leave_admin(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_cancel_active_leave(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adjust_leave_balance(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_leave_accrual_rule(uuid, numeric, numeric, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accrue_monthly_leave(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_leave_types_for_branch(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.submit_leave_request(uuid, date, date, text, public.leave_request_kind, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_leave_dept(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_leave_admin(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_active_leave(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adjust_leave_balance(uuid, uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_leave_accrual_rule(uuid, numeric, numeric, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accrue_monthly_leave(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_leave_types_for_branch(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_leave_perm(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leave_available_days(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_leave_to_schedule_shifts(uuid, date, date, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.write_leave_audit(text, uuid, uuid, jsonb, uuid) TO authenticated, service_role;
