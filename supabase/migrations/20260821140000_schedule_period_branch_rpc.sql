-- Pass explicit branch id from client header + read helper for schedule period config.

CREATE OR REPLACE FUNCTION public.get_schedule_period_settings(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid := COALESCE(p_branch_id, public.current_active_branch());
  v_row public.company_settings%ROWTYPE;
  v_from_extra jsonb;
BEGIN
  SELECT *
  INTO v_row
  FROM public.company_settings cs
  WHERE cs.is_active = true
    AND cs.branch_id IS NOT DISTINCT FROM v_branch
  ORDER BY cs.created_at ASC
  LIMIT 1;

  IF NOT FOUND AND v_branch IS NOT NULL THEN
    SELECT *
    INTO v_row
    FROM public.company_settings cs
    WHERE cs.is_active = true
      AND cs.branch_id IS NULL
    ORDER BY cs.created_at ASC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_from_extra := v_row.extra -> 'schedule_period';

  RETURN jsonb_build_object(
    'schedule_type',
      COALESCE(v_from_extra ->> 'schedule_type', v_row.schedule_type, 'weekly'),
    'week_start_dow',
      COALESCE(
        NULLIF(v_from_extra ->> 'week_start_dow', '')::int,
        v_row.week_start_dow,
        0
      ),
    'week_end_dow',
      COALESCE(
        NULLIF(v_from_extra ->> 'week_end_dow', '')::int,
        v_row.week_end_dow,
        6
      ),
    'monthly_working_dows',
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(v_from_extra -> 'monthly_working_dows'))::int[],
        v_row.monthly_working_dows,
        '{0,1,2,3,4,5,6}'::int[]
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_schedule_period_settings(
  p_schedule_type text,
  p_week_start_dow smallint,
  p_week_end_dow smallint,
  p_monthly_working_dows smallint[],
  p_extra jsonb DEFAULT '{}'::jsonb,
  p_branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_branch uuid := COALESCE(p_branch_id, public.current_active_branch());
  v_row public.company_settings%ROWTYPE;
  v_extra jsonb := COALESCE(p_extra, '{}'::jsonb);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT (
    public.is_platform_owner(v_uid)
    OR public.has_role(v_uid, 'main_admin')
    OR public.has_role(v_uid, 'system_admin')
    OR public.has_schedule_manage_perm(v_uid)
  ) THEN
    RAISE EXCEPTION 'insufficient privileges';
  END IF;

  IF p_schedule_type NOT IN ('weekly', 'monthly', 'custom') THEN
    RAISE EXCEPTION 'invalid schedule_type';
  END IF;

  IF p_week_start_dow < 0 OR p_week_start_dow > 6 OR p_week_end_dow < 0 OR p_week_end_dow > 6 THEN
    RAISE EXCEPTION 'invalid week day';
  END IF;

  SELECT *
  INTO v_row
  FROM public.company_settings cs
  WHERE cs.is_active = true
    AND cs.branch_id IS NOT DISTINCT FROM v_branch
  ORDER BY cs.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.company_settings
    SET
      schedule_type = p_schedule_type,
      week_start_dow = p_week_start_dow,
      week_end_dow = p_week_end_dow,
      monthly_working_dows = COALESCE(p_monthly_working_dows, '{0,1,2,3,4,5,6}'::smallint[]),
      extra = v_extra,
      updated_at = now()
    WHERE id = v_row.id
    RETURNING id INTO v_row.id;
    RETURN v_row.id;
  END IF;

  INSERT INTO public.company_settings (
    is_active,
    branch_id,
    company_name,
    schedule_type,
    week_start_dow,
    week_end_dow,
    monthly_working_dows,
    extra
  )
  VALUES (
    true,
    v_branch,
    COALESCE(
      (SELECT cs.company_name FROM public.company_settings cs WHERE cs.is_active = true ORDER BY cs.created_at ASC LIMIT 1),
      'חברה'
    ),
    p_schedule_type,
    p_week_start_dow,
    p_week_end_dow,
    COALESCE(p_monthly_working_dows, '{0,1,2,3,4,5,6}'::smallint[]),
    v_extra
  )
  RETURNING id INTO v_row.id;

  RETURN v_row.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_schedule_period_settings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_schedule_period_settings(text, smallint, smallint, smallint[], jsonb, uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
