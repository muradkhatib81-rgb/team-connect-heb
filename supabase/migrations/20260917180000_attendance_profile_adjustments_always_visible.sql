-- Profile MUST list that employee's own pay adjustments with type labels,
-- even when the punch card is hidden and even when the selected month is empty.
-- Hours-report adjustment lines stay behind attendance_can_run_hours_report
-- (Platform Owner or can_report). This is not a separate adjustments report.

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
  v_all_adjustments jsonb := '[]'::jsonb;
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
      'all_adjustments', '[]'::jsonb,
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
      'all_adjustments', '[]'::jsonb,
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

  SELECT COALESCE(jsonb_agg(x.obj ORDER BY x.adjustment_date DESC, x.created_at DESC), '[]'::jsonb)
    INTO v_all_adjustments
  FROM (
    SELECT
      jsonb_build_object(
        'id', a.id,
        'adjustment_date', a.adjustment_date,
        'year_month', a.year_month,
        'type', a.adjustment_type,
        'amount', a.amount,
        'signed_amount', public.attendance_adjustment_signed_amount(a.adjustment_type, a.amount),
        'note', a.note
      ) AS obj,
      a.adjustment_date,
      a.created_at
    FROM public.attendance_pay_adjustments a
    WHERE a.employee_id = v_uid
    ORDER BY a.adjustment_date DESC, a.created_at DESC
    LIMIT 100
  ) x;

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
    'all_adjustments', COALESCE(v_all_adjustments, '[]'::jsonb),
    'estimated_pay', v_pay
  );
END;
$$;

COMMENT ON FUNCTION public.get_attendance_my_hours_history(text) IS
  'Self-only profile hours + own pay adjustments. Visible if punch card would show OR the employee has adjustments. Always returns that employee''s ledger rows (selected month + recent all) with type labels. No other-user argument. Hours-report viewers are a separate audience (can_report / PO).';

REVOKE ALL ON FUNCTION public.get_attendance_my_hours_history(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_my_hours_history(text) TO authenticated, service_role;
