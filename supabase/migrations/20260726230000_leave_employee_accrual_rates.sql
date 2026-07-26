-- Per-employee leave accrual rates (override branch defaults).
-- Editable only via has_leave_perm(..., 'balance') — platform owner always;
-- branch/assistant managers only when can_edit_leave_balance is granted.

CREATE TABLE IF NOT EXISTS public.leave_employee_accrual_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
  days_per_month numeric(6,2) NOT NULL DEFAULT 0 CHECK (days_per_month >= 0),
  max_cap numeric(8,2),
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, leave_type_id)
);

CREATE INDEX IF NOT EXISTS idx_leave_emp_accrual_branch
  ON public.leave_employee_accrual_rates(branch_id);
CREATE INDEX IF NOT EXISTS idx_leave_emp_accrual_user
  ON public.leave_employee_accrual_rates(user_id);

COMMENT ON TABLE public.leave_employee_accrual_rates IS
  'Per-employee monthly accrual override. When present and active, replaces branch leave_accrual_rules for that user+type.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_employee_accrual_rates TO authenticated;
GRANT ALL ON public.leave_employee_accrual_rates TO service_role;

ALTER TABLE public.leave_employee_accrual_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_emp_accrual_branch_scope ON public.leave_employee_accrual_rates;
CREATE POLICY leave_emp_accrual_branch_scope ON public.leave_employee_accrual_rates AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id = public.current_active_branch()
  );

DROP POLICY IF EXISTS leave_emp_accrual_select ON public.leave_employee_accrual_rates;
CREATE POLICY leave_emp_accrual_select ON public.leave_employee_accrual_rates
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_leave_perm(auth.uid(), 'view')
    OR public.has_leave_perm(auth.uid(), 'balance')
  );

DROP POLICY IF EXISTS leave_emp_accrual_write ON public.leave_employee_accrual_rates;
CREATE POLICY leave_emp_accrual_write ON public.leave_employee_accrual_rates
  FOR ALL TO authenticated
  USING (public.has_leave_perm(auth.uid(), 'balance'))
  WITH CHECK (public.has_leave_perm(auth.uid(), 'balance'));

-- Set / clear per-employee accrual rate
CREATE OR REPLACE FUNCTION public.set_leave_employee_accrual_rate(
  _user_id uuid,
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
  v_branch uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'לא מחובר'; END IF;
  IF NOT public.has_leave_perm(v_actor, 'balance') THEN
    RAISE EXCEPTION 'אין הרשאה לעריכת שיעור צבירה לעובד';
  END IF;
  IF _user_id IS NULL OR _leave_type_id IS NULL THEN
    RAISE EXCEPTION 'חסר עובד או סוג חופשה';
  END IF;
  IF _days_per_month IS NULL OR _days_per_month < 0 THEN
    RAISE EXCEPTION 'ערך לא תקין';
  END IF;

  SELECT branch_id INTO v_branch FROM public.profiles WHERE id = _user_id;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'לעובד אין סניף';
  END IF;

  -- Non-owners must stay on their active branch
  IF NOT public.is_platform_owner(v_actor) THEN
    IF public.current_active_branch() IS DISTINCT FROM v_branch THEN
      RAISE EXCEPTION 'אין הרשאה לסניף של העובד';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leave_types
    WHERE id = _leave_type_id AND branch_id = v_branch
  ) THEN
    RAISE EXCEPTION 'סוג חופשה לא שייך לסניף העובד';
  END IF;

  INSERT INTO public.leave_employee_accrual_rates (
    user_id, branch_id, leave_type_id, days_per_month, max_cap, is_active, updated_by
  )
  VALUES (
    _user_id, v_branch, _leave_type_id, _days_per_month, _max_cap, _is_active, v_actor
  )
  ON CONFLICT (user_id, leave_type_id) DO UPDATE SET
    days_per_month = EXCLUDED.days_per_month,
    max_cap = EXCLUDED.max_cap,
    is_active = EXCLUDED.is_active,
    branch_id = EXCLUDED.branch_id,
    updated_by = v_actor,
    updated_at = now();

  PERFORM public.write_leave_audit(
    'employee_accrual_updated', NULL, _user_id,
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

GRANT EXECUTE ON FUNCTION public.set_leave_employee_accrual_rate(uuid, uuid, numeric, numeric, boolean)
  TO authenticated, service_role;

-- Monthly accrual: employee override wins when active; else branch default
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
  v_days numeric;
  v_cap numeric;
BEGIN
  FOR rec IN
    SELECT
      p.id AS user_id,
      p.branch_id,
      lt.id AS leave_type_id,
      CASE
        WHEN er.id IS NOT NULL AND er.is_active THEN er.days_per_month
        WHEN ar.id IS NOT NULL AND ar.is_active THEN ar.days_per_month
        ELSE NULL
      END AS days_per_month,
      CASE
        WHEN er.id IS NOT NULL AND er.is_active THEN er.max_cap
        WHEN ar.id IS NOT NULL AND ar.is_active THEN ar.max_cap
        ELSE NULL
      END AS max_cap
    FROM public.profiles p
    JOIN public.leave_types lt
      ON lt.branch_id = p.branch_id
     AND COALESCE(lt.is_active, true)
    LEFT JOIN public.leave_employee_accrual_rates er
      ON er.user_id = p.id
     AND er.leave_type_id = lt.id
    LEFT JOIN public.leave_accrual_rules ar
      ON ar.branch_id = p.branch_id
     AND ar.leave_type_id = lt.id
    WHERE p.branch_id IS NOT NULL
      AND p.is_active IS DISTINCT FROM false
      AND (_branch_id IS NULL OR p.branch_id = _branch_id)
  LOOP
    v_days := rec.days_per_month;
    IF v_days IS NULL OR v_days <= 0 THEN
      CONTINUE;
    END IF;
    v_cap := rec.max_cap;

    bal := public.ensure_leave_balance(rec.user_id, rec.leave_type_id, rec.branch_id);
    v_new := bal.accrued_days + v_days;
    IF v_cap IS NOT NULL THEN
      v_new := LEAST(v_new, v_cap);
    END IF;
    IF v_new <> bal.accrued_days THEN
      UPDATE public.leave_balances
         SET accrued_days = v_new, updated_at = now()
       WHERE id = bal.id;
      INSERT INTO public.leave_balance_adjustments (
        user_id, branch_id, leave_type_id, delta, reason, actor_id
      )
      VALUES (
        rec.user_id, rec.branch_id, rec.leave_type_id,
        v_new - bal.accrued_days, 'צבירה חודשית אוטומטית', NULL
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

NOTIFY pgrst, 'reload schema';
