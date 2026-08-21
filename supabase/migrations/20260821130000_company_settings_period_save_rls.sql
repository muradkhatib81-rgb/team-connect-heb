-- Platform owners / schedule managers could read company_settings but UPDATE returned 0 rows
-- because restrictive branch scope required branch_id = current_active_branch() with no owner bypass.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS week_start_dow smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS week_end_dow smallint NOT NULL DEFAULT 6;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS monthly_working_dows smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}';

DROP POLICY IF EXISTS company_settings_update_active_branch_scope ON public.company_settings;
CREATE POLICY company_settings_update_active_branch_scope
  ON public.company_settings
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NOT DISTINCT FROM public.current_active_branch()
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NOT DISTINCT FROM public.current_active_branch()
  );

DROP POLICY IF EXISTS company_settings_update_granular ON public.company_settings;
CREATE POLICY company_settings_update_granular
  ON public.company_settings
  FOR UPDATE
  TO authenticated
  USING (
    public.has_company_settings_manage_perm(auth.uid())
    AND (
      public.is_platform_owner(auth.uid())
      OR branch_id IS NOT DISTINCT FROM public.current_active_branch()
    )
  )
  WITH CHECK (
    public.has_company_settings_manage_perm(auth.uid())
    AND (
      public.is_platform_owner(auth.uid())
      OR branch_id IS NOT DISTINCT FROM public.current_active_branch()
    )
  );

DROP POLICY IF EXISTS company_settings_insert_granular ON public.company_settings;
CREATE POLICY company_settings_insert_granular
  ON public.company_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_company_settings_manage_perm(auth.uid())
    AND (
      public.is_platform_owner(auth.uid())
      OR branch_id IS NOT DISTINCT FROM public.current_active_branch()
    )
  );

DROP POLICY IF EXISTS company_settings_update_main_admin ON public.company_settings;
CREATE POLICY company_settings_update_main_admin
  ON public.company_settings
  FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin')
    OR public.has_role(auth.uid(), 'system_admin')
    OR public.has_schedule_manage_perm(auth.uid())
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin')
    OR public.has_role(auth.uid(), 'system_admin')
    OR public.has_schedule_manage_perm(auth.uid())
  );

DROP POLICY IF EXISTS company_settings_insert_main_admin ON public.company_settings;
CREATE POLICY company_settings_insert_main_admin
  ON public.company_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin')
    OR public.has_role(auth.uid(), 'system_admin')
    OR public.has_schedule_manage_perm(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.save_schedule_period_settings(
  p_schedule_type text,
  p_week_start_dow smallint,
  p_week_end_dow smallint,
  p_monthly_working_dows smallint[],
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_branch uuid := public.current_active_branch();
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

GRANT EXECUTE ON FUNCTION public.save_schedule_period_settings(text, smallint, smallint, smallint[], jsonb)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
