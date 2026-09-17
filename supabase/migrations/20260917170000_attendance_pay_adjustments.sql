-- Pay adjustments ledger + PO-only can_adjust_pay grant.
-- Does NOT touch user_roles / user_task_permissions / app_role / Permissions page.
-- Who can CREATE: Platform Owner or attendance_user_grants.can_adjust_pay (cap).
-- Who sees adjustments on the hours report: PO or can_report (same as the report).
-- Employees always see their own adjustments on /profile.

-- ---------------------------------------------------------------------------
-- 1) Grant flag + per-grantee single-adjustment cap
-- ---------------------------------------------------------------------------
ALTER TABLE public.attendance_user_grants
  ADD COLUMN IF NOT EXISTS can_adjust_pay boolean NOT NULL DEFAULT false;

ALTER TABLE public.attendance_user_grants
  ADD COLUMN IF NOT EXISTS adjust_pay_max_amount numeric(12,2) NULL;

ALTER TABLE public.attendance_user_grants
  DROP CONSTRAINT IF EXISTS attendance_user_grants_any_cap;
ALTER TABLE public.attendance_user_grants
  ADD CONSTRAINT attendance_user_grants_any_cap CHECK (
    can_view OR can_edit OR can_delete OR can_report OR can_adjust_pay
  );

ALTER TABLE public.attendance_user_grants
  DROP CONSTRAINT IF EXISTS attendance_user_grants_adjust_cap;
ALTER TABLE public.attendance_user_grants
  ADD CONSTRAINT attendance_user_grants_adjust_cap CHECK (
    (NOT can_adjust_pay)
    OR (adjust_pay_max_amount IS NOT NULL AND adjust_pay_max_amount > 0 AND adjust_pay_max_amount <= 100000)
  );

COMMENT ON COLUMN public.attendance_user_grants.can_adjust_pay IS
  'PO-picked grant to post pay adjustments. Not implied by manager roles or can_report.';
COMMENT ON COLUMN public.attendance_user_grants.adjust_pay_max_amount IS
  'Max absolute amount of a single adjustment for this grantee. Unused for Platform Owner.';

-- ---------------------------------------------------------------------------
-- 2) Permanent ledger (kept with punches; no purge)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_pay_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id uuid NULL,
  branch_id uuid NULL,
  adjustment_date date NOT NULL,
  year_month text NOT NULL,
  adjustment_type text NOT NULL CHECK (
    adjustment_type IN ('deduct_work_day', 'deduct_amount', 'add_amount')
  ),
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 100000),
  note text NULL,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_pay_adjustments_year_month_fmt CHECK (year_month ~ '^\d{4}-\d{2}$'),
  CONSTRAINT attendance_pay_adjustments_scope_chk CHECK (
    branch_id IS NOT NULL OR company_id IS NOT NULL
  )
);

COMMENT ON TABLE public.attendance_pay_adjustments IS
  'Permanent pay adjustment ledger per employee. Amount is always positive; sign is implied by adjustment_type.';

CREATE INDEX IF NOT EXISTS attendance_pay_adjustments_employee_date_idx
  ON public.attendance_pay_adjustments (employee_id, adjustment_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS attendance_pay_adjustments_branch_date_idx
  ON public.attendance_pay_adjustments (branch_id, adjustment_date DESC);

CREATE OR REPLACE FUNCTION public.sync_attendance_pay_adjustment_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.adjustment_date IS NOT NULL THEN
    NEW.year_month := to_char(NEW.adjustment_date, 'YYYY-MM');
  END IF;
  IF NEW.branch_id IS NOT NULL THEN
    NEW.company_id := COALESCE(NEW.company_id, public.company_id_of_branch(NEW.branch_id));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_pay_adjustment_scope ON public.attendance_pay_adjustments;
CREATE TRIGGER trg_attendance_pay_adjustment_scope
  BEFORE INSERT OR UPDATE OF branch_id, company_id, adjustment_date
  ON public.attendance_pay_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_attendance_pay_adjustment_scope();

REVOKE ALL ON public.attendance_pay_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.attendance_pay_adjustments TO authenticated;
GRANT ALL ON public.attendance_pay_adjustments TO service_role;

ALTER TABLE public.attendance_pay_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_pay_adjustments_select ON public.attendance_pay_adjustments;
CREATE POLICY attendance_pay_adjustments_select ON public.attendance_pay_adjustments
  FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR public.is_platform_owner(auth.uid())
  );

-- Writes go through SECURITY DEFINER RPCs (grantee cap + scope).
DROP POLICY IF EXISTS attendance_pay_adjustments_owner_write ON public.attendance_pay_adjustments;
CREATE POLICY attendance_pay_adjustments_owner_write ON public.attendance_pay_adjustments
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3) Gate: PO or can_adjust_pay grant (never has_role / manager auto)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_can_adjust_pay(_branch_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_platform_owner(v_uid) THEN
    RETURN true;
  END IF;
  IF _branch_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.attendance_user_grants g
      WHERE g.user_id = v_uid
        AND g.can_adjust_pay IS TRUE
        AND g.branch_id = _branch_id
    );
  END IF;
  IF _company_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.attendance_user_grants g
    WHERE g.user_id = v_uid
      AND g.can_adjust_pay IS TRUE
      AND g.branch_id IS NULL
      AND g.company_id = _company_id
      AND public.attendance_company_branch_count(g.company_id) = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attendance_can_adjust_pay(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_can_adjust_pay(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.attendance_adjust_pay_max_amount(_branch_id uuid, _company_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_max numeric;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;
  IF public.is_platform_owner(v_uid) THEN
    RETURN NULL;
  END IF;
  IF _branch_id IS NOT NULL THEN
    SELECT g.adjust_pay_max_amount INTO v_max
    FROM public.attendance_user_grants g
    WHERE g.user_id = v_uid
      AND g.can_adjust_pay IS TRUE
      AND g.branch_id = _branch_id
    LIMIT 1;
    RETURN v_max;
  END IF;
  SELECT g.adjust_pay_max_amount INTO v_max
  FROM public.attendance_user_grants g
  WHERE g.user_id = v_uid
    AND g.can_adjust_pay IS TRUE
    AND g.branch_id IS NULL
    AND g.company_id = _company_id
  LIMIT 1;
  RETURN v_max;
END;
$$;

REVOKE ALL ON FUNCTION public.attendance_adjust_pay_max_amount(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_adjust_pay_max_amount(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.attendance_adjustment_signed_amount(_type text, _amount numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _amount IS NULL OR _amount <= 0 THEN 0
    WHEN _type = 'add_amount' THEN ROUND(_amount, 2)
    ELSE ROUND(-_amount, 2)
  END;
$$;

REVOKE ALL ON FUNCTION public.attendance_adjustment_signed_amount(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_adjustment_signed_amount(text, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Capabilities: expose can_adjust_pay (does not imply can_view / can_report)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_attendance_my_capabilities(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_enabled boolean;
  v_grant public.attendance_user_grants%ROWTYPE;
  v_owner boolean;
  v_profile record;
  v_on_leave boolean;
  v_has_shift boolean := false;
  v_on_mgmt boolean := false;
  v_branch_ok boolean := false;
  v_active boolean := false;
  v_title_ok boolean := false;
  v_can_punch boolean := false;
  v_can_view boolean := false;
  v_can_edit boolean := false;
  v_can_delete boolean := false;
  v_can_report boolean := false;
  v_can_adjust boolean := false;
  v_adjust_max numeric := NULL;
  v_hide_reason text := null;
  v_show_employee boolean := false;
BEGIN
  IF v_uid IS NULL OR _branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'enabled', false,
      'can_punch', false,
      'can_view', false,
      'can_edit', false,
      'can_delete', false,
      'can_report', false,
      'can_adjust_pay', false,
      'adjust_pay_max_amount', NULL,
      'is_platform_owner', false,
      'show_employee_card', false,
      'show_manager_card', false,
      'hide_reason', 'no_context'
    );
  END IF;

  v_owner := public.is_platform_owner(v_uid);
  v_enabled := public.is_attendance_enabled_for_branch(_branch_id);

  SELECT
    p.branch_id,
    COALESCE(p.is_active, false) AS is_active,
    p.department_id,
    p.job_title
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'enabled', v_enabled,
      'can_punch', false,
      'can_view', false,
      'can_edit', false,
      'can_delete', false,
      'can_report', v_owner,
      'can_adjust_pay', v_owner,
      'adjust_pay_max_amount', NULL,
      'is_platform_owner', v_owner,
      'show_employee_card', false,
      'show_manager_card', false,
      'hide_reason', 'inactive'
    );
  END IF;

  v_active := v_profile.is_active IS TRUE;
  v_branch_ok := v_profile.branch_id IS NOT NULL AND v_profile.branch_id = _branch_id;
  v_on_leave := public.attendance_profile_on_leave_today(v_uid, now());
  v_title_ok := public.attendance_user_allows_punch(v_uid);
  v_on_mgmt := public.is_management_on_shift(v_uid, _branch_id);
  v_has_shift := public.attendance_has_punchable_presence(v_uid, _branch_id, now());

  SELECT * INTO v_grant
  FROM public.attendance_user_grants g
  WHERE g.user_id = v_uid AND g.branch_id = _branch_id
  LIMIT 1;

  v_can_view := v_owner
    OR COALESCE(v_grant.can_view, false)
    OR COALESCE(v_grant.can_edit, false)
    OR COALESCE(v_grant.can_delete, false);
  v_can_edit := v_owner OR COALESCE(v_grant.can_edit, false);
  v_can_delete := v_owner OR COALESCE(v_grant.can_delete, false);
  v_can_report := v_owner
    OR COALESCE(v_grant.can_report, false)
    OR EXISTS (
      SELECT 1
      FROM public.attendance_user_grants g2
      WHERE g2.user_id = v_uid
        AND g2.can_report IS TRUE
        AND g2.branch_id IS NULL
        AND g2.company_id IS NOT NULL
        AND public.attendance_company_branch_count(g2.company_id) = 0
        AND (
          g2.company_id = public.company_id_of_branch(_branch_id)
          OR g2.company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = v_uid)
        )
    );
  v_can_adjust := v_owner
    OR COALESCE(v_grant.can_adjust_pay, false)
    OR EXISTS (
      SELECT 1
      FROM public.attendance_user_grants g3
      WHERE g3.user_id = v_uid
        AND g3.can_adjust_pay IS TRUE
        AND g3.branch_id IS NULL
        AND g3.company_id IS NOT NULL
        AND public.attendance_company_branch_count(g3.company_id) = 0
        AND (
          g3.company_id = public.company_id_of_branch(_branch_id)
          OR g3.company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = v_uid)
        )
    );
  IF v_owner THEN
    v_adjust_max := NULL;
  ELSIF COALESCE(v_grant.can_adjust_pay, false) THEN
    v_adjust_max := v_grant.adjust_pay_max_amount;
  ELSE
    SELECT g3.adjust_pay_max_amount INTO v_adjust_max
    FROM public.attendance_user_grants g3
    WHERE g3.user_id = v_uid
      AND g3.can_adjust_pay IS TRUE
      AND g3.branch_id IS NULL
      AND g3.company_id IS NOT NULL
      AND public.attendance_company_branch_count(g3.company_id) = 0
      AND (
        g3.company_id = public.company_id_of_branch(_branch_id)
        OR g3.company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = v_uid)
      )
    LIMIT 1;
  END IF;

  IF NOT v_enabled THEN
    v_hide_reason := 'feature_disabled';
  ELSIF NOT v_active THEN
    v_hide_reason := 'inactive';
  ELSIF NOT v_branch_ok THEN
    v_hide_reason := 'wrong_branch';
  ELSIF NOT v_title_ok THEN
    v_hide_reason := 'role_denied';
  ELSIF v_on_leave THEN
    v_hide_reason := 'on_leave';
  ELSIF NOT v_has_shift THEN
    v_hide_reason := 'no_shift';
  ELSE
    v_can_punch := true;
  END IF;

  v_show_employee := v_enabled AND v_active AND v_branch_ok AND v_title_ok;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'can_punch', v_can_punch,
    'can_view', v_can_view,
    'can_edit', v_can_edit,
    'can_delete', v_can_delete,
    'can_report', v_can_report,
    'can_adjust_pay', v_can_adjust,
    'adjust_pay_max_amount', v_adjust_max,
    'is_platform_owner', v_owner,
    'show_employee_card', v_show_employee,
    'show_manager_card', v_enabled AND v_can_view AND (v_owner OR (v_active AND v_branch_ok)),
    'hide_reason', v_hide_reason,
    'has_shift_today', v_has_shift,
    'on_management_shift', v_on_mgmt,
    'on_leave', v_on_leave,
    'branch_match', v_branch_ok,
    'title_allows_punch', v_title_ok
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_my_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_my_capabilities(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Scopes / employees / create / list for grantees
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_attendance_adjust_scopes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner boolean;
  v_scopes jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  v_owner := public.is_platform_owner(v_uid);

  IF v_owner THEN
    SELECT COALESCE(jsonb_agg(x.obj ORDER BY x.sort_name, x.branch_name), '[]'::jsonb)
      INTO v_scopes
    FROM (
      SELECT
        jsonb_build_object(
          'company_id', c.id,
          'company_name', c.name,
          'branch_id', NULL,
          'branch_name', NULL,
          'has_branches', false,
          'scope_kind', 'company',
          'adjust_pay_max_amount', NULL
        ) AS obj,
        c.name AS sort_name,
        '' AS branch_name
      FROM public.companies c
      WHERE c.deleted_at IS NULL
        AND public.attendance_company_branch_count(c.id) = 0
      UNION ALL
      SELECT
        jsonb_build_object(
          'company_id', c.id,
          'company_name', c.name,
          'branch_id', cba.source_branch_id,
          'branch_name', COALESCE(b.name, cba.name, cba.source_branch_id::text),
          'has_branches', true,
          'scope_kind', 'branch',
          'adjust_pay_max_amount', NULL
        ) AS obj,
        c.name AS sort_name,
        COALESCE(b.name, cba.name, '') AS branch_name
      FROM public.company_branch_assignments cba
      JOIN public.companies c ON c.id = cba.company_id AND c.deleted_at IS NULL
      LEFT JOIN public.branches b ON b.id = cba.source_branch_id
      WHERE cba.deleted_at IS NULL
    ) x;
  ELSE
    SELECT COALESCE(jsonb_agg(x.obj ORDER BY x.sort_name, x.branch_name), '[]'::jsonb)
      INTO v_scopes
    FROM (
      SELECT
        jsonb_build_object(
          'company_id', g.company_id,
          'company_name', c.name,
          'branch_id', g.branch_id,
          'branch_name', CASE
            WHEN g.branch_id IS NULL THEN NULL
            ELSE COALESCE(b.name, g.branch_id::text)
          END,
          'has_branches', g.branch_id IS NOT NULL,
          'scope_kind', CASE WHEN g.branch_id IS NULL THEN 'company' ELSE 'branch' END,
          'adjust_pay_max_amount', g.adjust_pay_max_amount
        ) AS obj,
        COALESCE(c.name, '') AS sort_name,
        COALESCE(b.name, '') AS branch_name
      FROM public.attendance_user_grants g
      LEFT JOIN public.companies c ON c.id = g.company_id
      LEFT JOIN public.branches b ON b.id = g.branch_id
      WHERE g.user_id = v_uid
        AND g.can_adjust_pay IS TRUE
        AND (
          g.branch_id IS NOT NULL
          OR (
            g.branch_id IS NULL
            AND g.company_id IS NOT NULL
            AND public.attendance_company_branch_count(g.company_id) = 0
          )
        )
    ) x;
  END IF;

  RETURN jsonb_build_object(
    'is_platform_owner', v_owner,
    'can_adjust_pay', v_owner OR jsonb_array_length(v_scopes) > 0,
    'adjust_pay_max_amount', CASE
      WHEN v_owner THEN NULL
      ELSE (
        SELECT MIN(g.adjust_pay_max_amount)
        FROM public.attendance_user_grants g
        WHERE g.user_id = v_uid AND g.can_adjust_pay IS TRUE
      )
    END,
    'scopes', COALESCE(v_scopes, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_attendance_adjust_scopes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_attendance_adjust_scopes() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_attendance_adjust_employees(_branch_id uuid, _company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF NOT public.attendance_can_adjust_pay(_branch_id, _company_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _branch_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'id_number', p.id_number,
      'hourly_rate', w.hourly_rate,
      'suggested_day_amount', CASE
        WHEN w.hourly_rate IS NULL THEN NULL
        ELSE ROUND(w.hourly_rate * 8, 2)
      END
    ) ORDER BY p.full_name), '[]'::jsonb)
    INTO v_rows
    FROM public.profiles p
    LEFT JOIN public.employee_hourly_wages w ON w.user_id = p.id
    WHERE p.branch_id = _branch_id;
  ELSE
    IF _company_id IS NULL THEN
      RAISE EXCEPTION 'COMPANY_OR_BRANCH_REQUIRED';
    END IF;
    IF public.attendance_company_branch_count(_company_id) > 0 THEN
      RAISE EXCEPTION 'BRANCH_REQUIRED';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'id_number', p.id_number,
      'hourly_rate', w.hourly_rate,
      'suggested_day_amount', CASE
        WHEN w.hourly_rate IS NULL THEN NULL
        ELSE ROUND(w.hourly_rate * 8, 2)
      END
    ) ORDER BY p.full_name), '[]'::jsonb)
    INTO v_rows
    FROM public.profiles p
    LEFT JOIN public.employee_hourly_wages w ON w.user_id = p.id
    WHERE p.company_id = _company_id;
  END IF;
  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_attendance_adjust_employees(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_attendance_adjust_employees(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_attendance_pay_adjustment(
  _employee_id uuid,
  _branch_id uuid,
  _company_id uuid,
  _adjustment_type text,
  _amount numeric,
  _adjustment_date date DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner boolean;
  v_max numeric;
  v_date date;
  v_emp record;
  v_row public.attendance_pay_adjustments%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF _employee_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_REQUIRED';
  END IF;
  IF _adjustment_type IS NULL OR _adjustment_type NOT IN ('deduct_work_day', 'deduct_amount', 'add_amount') THEN
    RAISE EXCEPTION 'INVALID_ADJUSTMENT_TYPE';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;
  IF _branch_id IS NULL AND _company_id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_OR_BRANCH_REQUIRED';
  END IF;
  IF _branch_id IS NULL AND public.attendance_company_branch_count(_company_id) > 0 THEN
    RAISE EXCEPTION 'BRANCH_REQUIRED';
  END IF;
  IF NOT public.attendance_can_adjust_pay(_branch_id, _company_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  v_owner := public.is_platform_owner(v_uid);
  v_max := public.attendance_adjust_pay_max_amount(_branch_id, _company_id);
  IF NOT v_owner THEN
    IF v_max IS NULL OR ROUND(_amount, 2) > v_max THEN
      RAISE EXCEPTION 'ADJUST_CAP_EXCEEDED';
    END IF;
  END IF;

  v_date := COALESCE(_adjustment_date, (now() AT TIME ZONE 'Asia/Jerusalem')::date);

  SELECT p.id, p.branch_id, p.company_id
    INTO v_emp
  FROM public.profiles p
  WHERE p.id = _employee_id
    AND (
      (_branch_id IS NOT NULL AND p.branch_id = _branch_id)
      OR (_branch_id IS NULL AND _company_id IS NOT NULL AND p.company_id = _company_id)
    );
  IF v_emp.id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_REQUIRED';
  END IF;

  INSERT INTO public.attendance_pay_adjustments (
    employee_id, company_id, branch_id, adjustment_date, year_month,
    adjustment_type, amount, note, created_by
  ) VALUES (
    v_emp.id,
    COALESCE(v_emp.company_id, _company_id, public.company_id_of_branch(v_emp.branch_id)),
    COALESCE(v_emp.branch_id, _branch_id),
    v_date,
    to_char(v_date, 'YYYY-MM'),
    _adjustment_type,
    ROUND(_amount, 2),
    NULLIF(btrim(COALESCE(_note, '')), ''),
    v_uid
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'employee_id', v_row.employee_id,
    'adjustment_date', v_row.adjustment_date,
    'year_month', v_row.year_month,
    'type', v_row.adjustment_type,
    'amount', v_row.amount,
    'signed_amount', public.attendance_adjustment_signed_amount(v_row.adjustment_type, v_row.amount),
    'note', v_row.note
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_attendance_pay_adjustment(uuid, uuid, uuid, text, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_attendance_pay_adjustment(uuid, uuid, uuid, text, numeric, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_attendance_pay_adjustments(
  _branch_id uuid,
  _company_id uuid,
  _limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lim integer := LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF NOT public.attendance_can_adjust_pay(_branch_id, _company_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT COALESCE(jsonb_agg(x.obj ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      jsonb_build_object(
        'id', a.id,
        'employee_id', a.employee_id,
        'full_name', p.full_name,
        'id_number', p.id_number,
        'adjustment_date', a.adjustment_date,
        'year_month', a.year_month,
        'type', a.adjustment_type,
        'amount', a.amount,
        'signed_amount', public.attendance_adjustment_signed_amount(a.adjustment_type, a.amount),
        'note', a.note,
        'created_at', a.created_at
      ) AS obj,
      a.created_at
    FROM public.attendance_pay_adjustments a
    JOIN public.profiles p ON p.id = a.employee_id
    WHERE
      CASE
        WHEN _branch_id IS NOT NULL THEN a.branch_id = _branch_id
        ELSE a.company_id = _company_id
      END
    ORDER BY a.created_at DESC
    LIMIT v_lim
  ) x;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_attendance_pay_adjustments(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_attendance_pay_adjustments(uuid, uuid, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Hours report: attach adjustments for can_report / PO (same audience)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_attendance_hours_report(
  _from date,
  _to date,
  _branch_id uuid,
  _company_id uuid,
  _filter text,
  _employee_id uuid DEFAULT NULL,
  _department_ids uuid[] DEFAULT NULL,
  _employee_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
  v_filter text := lower(COALESCE(_filter, 'punchers'));
  v_rows jsonb;
  v_totals jsonb;
  v_dept_totals jsonb;
  v_departments jsonb;
  v_dept_ids uuid[];
  v_emp_ids uuid[];
  v_emp_requested uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;
  IF _to > _from + 400 THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;
  IF v_filter = 'one' THEN
    v_filter := 'employees';
  END IF;
  IF v_filter NOT IN ('all', 'punchers', 'employees') THEN
    RAISE EXCEPTION 'INVALID_FILTER';
  END IF;
  IF _branch_id IS NULL AND _company_id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_OR_BRANCH_REQUIRED';
  END IF;
  IF _branch_id IS NULL AND public.attendance_company_branch_count(_company_id) > 0 THEN
    RAISE EXCEPTION 'BRANCH_REQUIRED';
  END IF;
  IF NOT public.attendance_can_run_hours_report(_branch_id, _company_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT x
    FROM unnest(COALESCE(_department_ids, ARRAY[]::uuid[])) AS x
    WHERE x IS NOT NULL
  ) INTO v_dept_ids;
  IF cardinality(v_dept_ids) = 0 THEN
    v_dept_ids := NULL;
  END IF;
  IF v_dept_ids IS NOT NULL AND cardinality(v_dept_ids) > 80 THEN
    RAISE EXCEPTION 'INVALID_DEPARTMENT';
  END IF;
  IF v_dept_ids IS NOT NULL AND EXISTS (
    SELECT 1
    FROM unnest(v_dept_ids) AS x(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.departments d
      WHERE d.id = x.id
        AND (
          (_branch_id IS NOT NULL AND d.branch_id = _branch_id)
          OR (_branch_id IS NULL AND _company_id IS NOT NULL AND d.company_id = _company_id)
        )
    )
  ) THEN
    RAISE EXCEPTION 'INVALID_DEPARTMENT';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT x
    FROM unnest(
      COALESCE(_employee_ids, ARRAY[]::uuid[])
      || CASE WHEN _employee_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[_employee_id] END
    ) AS x
    WHERE x IS NOT NULL
  ) INTO v_emp_requested;
  IF cardinality(v_emp_requested) = 0 THEN
    v_emp_requested := NULL;
  END IF;
  IF v_emp_requested IS NOT NULL AND cardinality(v_emp_requested) > 200 THEN
    RAISE EXCEPTION 'INVALID_FILTER';
  END IF;

  IF v_emp_requested IS NOT NULL THEN
    SELECT ARRAY(
      SELECT p.id
      FROM public.profiles p
      WHERE p.id = ANY(v_emp_requested)
        AND (
          (_branch_id IS NOT NULL AND p.branch_id = _branch_id)
          OR (_branch_id IS NULL AND _company_id IS NOT NULL AND p.company_id = _company_id)
        )
    ) INTO v_emp_ids;
    IF cardinality(v_emp_ids) = 0 THEN
      v_emp_ids := NULL;
    END IF;
  ELSE
    v_emp_ids := NULL;
  END IF;

  IF v_filter = 'employees' AND v_emp_ids IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_REQUIRED';
  END IF;

  IF v_dept_ids IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name), '[]'::jsonb)
      INTO v_departments
    FROM public.departments d
    WHERE d.id = ANY(v_dept_ids);
  ELSE
    v_departments := '[]'::jsonb;
  END IF;

  SELECT r.range_start, r.range_end
    INTO v_start, v_end
  FROM public.attendance_jerusalem_range(_from, _to) r;

  WITH scoped_profiles AS (
    SELECT p.id, p.full_name, p.id_number, p.department_id
    FROM public.profiles p
    WHERE
      CASE
        WHEN v_emp_ids IS NOT NULL THEN p.id = ANY(v_emp_ids)
        WHEN _branch_id IS NOT NULL THEN p.branch_id = _branch_id
        ELSE p.company_id = _company_id
      END
      AND (
        v_emp_ids IS NOT NULL
        OR v_dept_ids IS NULL
        OR p.department_id = ANY(v_dept_ids)
      )
  ),
  hours AS (
    SELECT
      s.user_id,
      SUM(public.attendance_clipped_seconds(s.clock_in_at, s.clock_out_at, v_start, v_end)) AS seconds
    FROM public.attendance_sessions s
    WHERE s.deleted_at IS NULL
      AND s.clock_out_at IS NOT NULL
      AND s.clock_in_at < v_end
      AND s.clock_out_at > v_start
      AND (
        CASE
          WHEN _branch_id IS NOT NULL THEN s.branch_id = _branch_id
          ELSE (
            s.company_id = _company_id
            OR s.user_id IN (SELECT id FROM scoped_profiles)
          )
        END
      )
      AND (v_emp_ids IS NULL OR s.user_id = ANY(v_emp_ids))
    GROUP BY s.user_id
  ),
  adj AS (
    SELECT
      a.employee_id AS user_id,
      COALESCE(SUM(public.attendance_adjustment_signed_amount(a.adjustment_type, a.amount)), 0) AS adj_net,
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'adjustment_date', a.adjustment_date,
          'year_month', a.year_month,
          'type', a.adjustment_type,
          'amount', a.amount,
          'signed_amount', public.attendance_adjustment_signed_amount(a.adjustment_type, a.amount),
          'note', a.note
        )
        ORDER BY a.adjustment_date, a.created_at
      ), '[]'::jsonb) AS adjustments
    FROM public.attendance_pay_adjustments a
    WHERE a.adjustment_date >= _from
      AND a.adjustment_date <= _to
      AND (
        CASE
          WHEN _branch_id IS NOT NULL THEN a.branch_id = _branch_id
          ELSE a.company_id = _company_id
        END
      )
      AND (v_emp_ids IS NULL OR a.employee_id = ANY(v_emp_ids))
    GROUP BY a.employee_id
  ),
  combined AS (
    SELECT
      p.id AS user_id,
      p.full_name,
      p.id_number,
      p.department_id,
      COALESCE(h.seconds, 0)::double precision AS seconds,
      w.hourly_rate
    FROM scoped_profiles p
    LEFT JOIN hours h ON h.user_id = p.id
    LEFT JOIN public.employee_hourly_wages w ON w.user_id = p.id
    UNION
    SELECT
      h.user_id,
      COALESCE(pr.full_name, h.user_id::text),
      pr.id_number,
      pr.department_id,
      h.seconds::double precision,
      w.hourly_rate
    FROM hours h
    LEFT JOIN public.profiles pr ON pr.id = h.user_id
    LEFT JOIN public.employee_hourly_wages w ON w.user_id = h.user_id
    WHERE NOT EXISTS (SELECT 1 FROM scoped_profiles sp WHERE sp.id = h.user_id)
      AND v_filter NOT IN ('employees')
      AND v_dept_ids IS NULL
      AND v_emp_ids IS NULL
    UNION
    SELECT
      a.user_id,
      COALESCE(pr.full_name, a.user_id::text),
      pr.id_number,
      pr.department_id,
      0::double precision,
      w.hourly_rate
    FROM adj a
    LEFT JOIN public.profiles pr ON pr.id = a.user_id
    LEFT JOIN public.employee_hourly_wages w ON w.user_id = a.user_id
    WHERE NOT EXISTS (SELECT 1 FROM scoped_profiles sp WHERE sp.id = a.user_id)
      AND NOT EXISTS (SELECT 1 FROM hours h WHERE h.user_id = a.user_id)
      AND v_filter NOT IN ('employees')
      AND v_dept_ids IS NULL
      AND v_emp_ids IS NULL
  ),
  filtered AS (
    SELECT DISTINCT ON (c.user_id)
      c.user_id,
      c.full_name,
      c.id_number,
      c.department_id,
      c.seconds,
      ROUND((c.seconds / 60.0)::numeric)::integer AS total_minutes,
      ROUND((c.seconds / 3600.0)::numeric, 2) AS total_hours,
      c.hourly_rate,
      CASE
        WHEN c.hourly_rate IS NULL THEN NULL
        ELSE ROUND(ROUND((c.seconds / 3600.0)::numeric, 2) * c.hourly_rate, 2)
      END AS hours_pay,
      COALESCE(a.adj_net, 0) AS adj_net,
      COALESCE(a.adjustments, '[]'::jsonb) AS adjustments,
      CASE
        WHEN c.hourly_rate IS NULL AND COALESCE(a.adj_net, 0) = 0 THEN NULL
        ELSE ROUND(
          COALESCE(
            CASE
              WHEN c.hourly_rate IS NULL THEN 0
              ELSE ROUND(ROUND((c.seconds / 3600.0)::numeric, 2) * c.hourly_rate, 2)
            END,
            0
          ) + COALESCE(a.adj_net, 0),
          2
        )
      END AS estimated_pay
    FROM combined c
    LEFT JOIN adj a ON a.user_id = c.user_id
    WHERE
      CASE v_filter
        WHEN 'punchers' THEN c.seconds > 0 OR COALESCE(jsonb_array_length(a.adjustments), 0) > 0
        WHEN 'employees' THEN v_emp_ids IS NOT NULL AND c.user_id = ANY(v_emp_ids)
        ELSE true
      END
    ORDER BY c.user_id, c.seconds DESC
  ),
  dept_totals AS (
    SELECT
      f.department_id,
      d.name AS department_name,
      SUM(f.seconds) AS seconds,
      COALESCE(SUM(f.estimated_pay), 0) AS estimated_pay
    FROM filtered f
    LEFT JOIN public.departments d ON d.id = f.department_id
    GROUP BY f.department_id, d.name
  )
  SELECT
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'user_id', f.user_id,
          'full_name', f.full_name,
          'id_number', f.id_number,
          'department_id', f.department_id,
          'department_name', d.name,
          'total_seconds', f.seconds,
          'total_minutes', f.total_minutes,
          'total_hours', f.total_hours,
          'hourly_rate', f.hourly_rate,
          'hours_pay', f.hours_pay,
          'adjustment_net', f.adj_net,
          'adjustments', f.adjustments,
          'estimated_pay', f.estimated_pay
        )
        ORDER BY f.full_name NULLS LAST
      )
      FROM filtered f
      LEFT JOIN public.departments d ON d.id = f.department_id
    ), '[]'::jsonb),
    jsonb_build_object(
      'total_seconds', COALESCE((SELECT SUM(f.seconds) FROM filtered f), 0),
      'total_minutes', ROUND(COALESCE((SELECT SUM(f.seconds) FROM filtered f), 0) / 60.0)::integer,
      'total_hours', ROUND((COALESCE((SELECT SUM(f.seconds) FROM filtered f), 0) / 3600.0)::numeric, 2),
      'adjustment_net', COALESCE((SELECT SUM(f.adj_net) FROM filtered f), 0),
      'estimated_pay', COALESCE((SELECT SUM(f.estimated_pay) FROM filtered f), 0)
    ),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'department_id', t.department_id,
          'department_name', t.department_name,
          'total_seconds', t.seconds,
          'total_minutes', ROUND((t.seconds / 60.0)::numeric)::integer,
          'total_hours', ROUND((t.seconds / 3600.0)::numeric, 2),
          'estimated_pay', t.estimated_pay
        )
        ORDER BY t.department_name NULLS LAST
      )
      FROM dept_totals t
    ), '[]'::jsonb)
  INTO v_rows, v_totals, v_dept_totals;

  RETURN jsonb_build_object(
    'ok', true,
    'from', _from,
    'to', _to,
    'branch_id', _branch_id,
    'company_id', _company_id,
    'department_ids', to_jsonb(COALESCE(v_dept_ids, ARRAY[]::uuid[])),
    'departments', COALESCE(v_departments, '[]'::jsonb),
    'department_id', CASE WHEN v_dept_ids IS NOT NULL AND cardinality(v_dept_ids) = 1 THEN v_dept_ids[1] ELSE NULL END,
    'department_name', CASE
      WHEN v_dept_ids IS NOT NULL AND cardinality(v_dept_ids) = 1
        THEN (SELECT d.name FROM public.departments d WHERE d.id = v_dept_ids[1])
      ELSE NULL
    END,
    'employee_ids', to_jsonb(COALESCE(v_emp_ids, ARRAY[]::uuid[])),
    'filter', v_filter,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'totals', COALESCE(v_totals, jsonb_build_object(
      'total_seconds', 0, 'total_minutes', 0, 'total_hours', 0, 'adjustment_net', 0, 'estimated_pay', 0
    )),
    'department_totals', COALESCE(v_dept_totals, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_hours_report(date, date, uuid, uuid, text, uuid, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_hours_report(date, date, uuid, uuid, text, uuid, uuid[], uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) Profile hours history: own adjustments for the selected month
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_attendance_my_hours_history(_year_month text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ym text;
  v_current text;
  v_from date;
  v_to date;
  v_start timestamptz;
  v_end timestamptz;
  v_branch uuid;
  v_caps jsonb;
  v_seconds double precision := 0;
  v_hours numeric := 0;
  v_minutes integer := 0;
  v_rate numeric := NULL;
  v_hours_pay numeric := NULL;
  v_pay numeric := NULL;
  v_adj_net numeric := 0;
  v_adjustments jsonb := '[]'::jsonb;
  v_months jsonb := '[]'::jsonb;
  v_hours_visible boolean := false;
  v_has_adj boolean := false;
BEGIN
  v_current := to_char((now() AT TIME ZONE 'Asia/Jerusalem'), 'YYYY-MM');
  v_ym := COALESCE(NULLIF(btrim(_year_month), ''), v_current);

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'visible', false,
      'year_month', v_ym,
      'current_year_month', v_current,
      'months', '[]'::jsonb,
      'total_seconds', 0,
      'total_minutes', 0,
      'total_hours', 0,
      'hourly_rate', NULL,
      'hours_pay', NULL,
      'adjustment_net', 0,
      'adjustments', '[]'::jsonb,
      'estimated_pay', NULL
    );
  END IF;

  IF v_ym !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;

  SELECT p.branch_id INTO v_branch
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_branch IS NOT NULL THEN
    v_caps := public.get_attendance_my_capabilities(v_branch);
    v_hours_visible := COALESCE((v_caps->>'enabled')::boolean, false) IS TRUE
      AND COALESCE((v_caps->>'show_employee_card')::boolean, false) IS TRUE;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.attendance_pay_adjustments a WHERE a.employee_id = v_uid
  ) INTO v_has_adj;

  IF NOT v_hours_visible AND NOT v_has_adj THEN
    RETURN jsonb_build_object(
      'visible', false,
      'year_month', v_ym,
      'current_year_month', v_current,
      'months', '[]'::jsonb,
      'total_seconds', 0,
      'total_minutes', 0,
      'total_hours', 0,
      'hourly_rate', NULL,
      'hours_pay', NULL,
      'adjustment_net', 0,
      'adjustments', '[]'::jsonb,
      'estimated_pay', NULL
    );
  END IF;

  v_from := (v_ym || '-01')::date;
  v_to := (date_trunc('month', v_from::timestamp) + interval '1 month' - interval '1 day')::date;

  SELECT r.range_start, r.range_end
    INTO v_start, v_end
  FROM public.attendance_jerusalem_range(v_from, v_to) r;

  SELECT COALESCE(SUM(public.attendance_clipped_seconds(
    s.clock_in_at, s.clock_out_at, v_start, v_end
  )), 0)
    INTO v_seconds
  FROM public.attendance_sessions s
  WHERE s.user_id = v_uid
    AND s.deleted_at IS NULL
    AND s.clock_out_at IS NOT NULL
    AND s.clock_in_at < v_end
    AND s.clock_out_at > v_start;

  v_minutes := ROUND(v_seconds / 60.0)::integer;
  v_hours := ROUND((v_seconds / 3600.0)::numeric, 2);

  SELECT w.hourly_rate INTO v_rate
  FROM public.employee_hourly_wages w
  WHERE w.user_id = v_uid;

  IF v_rate IS NOT NULL THEN
    v_hours_pay := ROUND(v_hours * v_rate, 2);
  END IF;

  SELECT
    COALESCE(SUM(public.attendance_adjustment_signed_amount(a.adjustment_type, a.amount)), 0),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'adjustment_date', a.adjustment_date,
        'year_month', a.year_month,
        'type', a.adjustment_type,
        'amount', a.amount,
        'signed_amount', public.attendance_adjustment_signed_amount(a.adjustment_type, a.amount),
        'note', a.note
      )
      ORDER BY a.adjustment_date, a.created_at
    ) FILTER (WHERE a.id IS NOT NULL), '[]'::jsonb)
    INTO v_adj_net, v_adjustments
  FROM public.attendance_pay_adjustments a
  WHERE a.employee_id = v_uid
    AND a.year_month = v_ym;

  IF v_hours_pay IS NULL AND COALESCE(v_adj_net, 0) = 0 THEN
    v_pay := NULL;
  ELSE
    v_pay := ROUND(COALESCE(v_hours_pay, 0) + COALESCE(v_adj_net, 0), 2);
  END IF;

  WITH closed AS (
    SELECT s.clock_in_at, s.clock_out_at
    FROM public.attendance_sessions s
    WHERE s.user_id = v_uid
      AND s.deleted_at IS NULL
      AND s.clock_out_at IS NOT NULL
      AND s.clock_out_at > s.clock_in_at
  ),
  month_candidates AS (
    SELECT DISTINCT to_char(gs, 'YYYY-MM') AS ym
    FROM closed
    CROSS JOIN LATERAL (
      SELECT
        date_trunc('month', clock_in_at AT TIME ZONE 'Asia/Jerusalem') AS start_m,
        date_trunc('month', (clock_out_at - interval '1 microsecond') AT TIME ZONE 'Asia/Jerusalem') AS end_m
    ) b
    CROSS JOIN LATERAL generate_series(
      b.start_m,
      CASE WHEN b.end_m < b.start_m THEN b.start_m ELSE b.end_m END,
      interval '1 month'
    ) AS gs
    WHERE b.start_m <= b.end_m
  ),
  with_hours AS (
    SELECT mc.ym
    FROM month_candidates mc
    CROSS JOIN LATERAL public.attendance_jerusalem_range(
      (mc.ym || '-01')::date,
      (date_trunc('month', (mc.ym || '-01')::date::timestamp) + interval '1 month' - interval '1 day')::date
    ) r
    WHERE EXISTS (
      SELECT 1
      FROM closed c
      WHERE public.attendance_clipped_seconds(c.clock_in_at, c.clock_out_at, r.range_start, r.range_end) > 0
    )
  ),
  listed AS (
    SELECT ym FROM with_hours
    UNION
    SELECT a.year_month AS ym
    FROM public.attendance_pay_adjustments a
    WHERE a.employee_id = v_uid
    UNION
    SELECT v_current AS ym
  )
  SELECT COALESCE(jsonb_agg(ym ORDER BY ym DESC), jsonb_build_array(v_current))
    INTO v_months
  FROM listed;

  RETURN jsonb_build_object(
    'visible', true,
    'year_month', v_ym,
    'current_year_month', v_current,
    'months', COALESCE(v_months, jsonb_build_array(v_current)),
    'total_seconds', v_seconds,
    'total_minutes', v_minutes,
    'total_hours', v_hours,
    'hourly_rate', v_rate,
    'hours_pay', v_hours_pay,
    'adjustment_net', COALESCE(v_adj_net, 0),
    'adjustments', COALESCE(v_adjustments, '[]'::jsonb),
    'estimated_pay', v_pay
  );
END;
$$;

COMMENT ON FUNCTION public.get_attendance_my_hours_history(text) IS
  'Self-only profile hours + own pay adjustments. Visible if punch card would show OR the employee has adjustments. No other-user argument.';

REVOKE ALL ON FUNCTION public.get_attendance_my_hours_history(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_my_hours_history(text) TO authenticated, service_role;
