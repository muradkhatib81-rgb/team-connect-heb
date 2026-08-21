-- Repair partial runs + allow platform owner / schedule managers to save period settings.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS week_start_dow smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS week_end_dow smallint NOT NULL DEFAULT 6;

ALTER TABLE public.company_settings
  DROP CONSTRAINT IF EXISTS company_settings_week_start_dow_chk;
ALTER TABLE public.company_settings
  ADD CONSTRAINT company_settings_week_start_dow_chk
  CHECK (week_start_dow >= 0 AND week_start_dow <= 6);

ALTER TABLE public.company_settings
  DROP CONSTRAINT IF EXISTS company_settings_week_end_dow_chk;
ALTER TABLE public.company_settings
  ADD CONSTRAINT company_settings_week_end_dow_chk
  CHECK (week_end_dow >= 0 AND week_end_dow <= 6);

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS monthly_working_dows smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}';

CREATE TABLE IF NOT EXISTS public.shift_definition_day_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_definition_id uuid NOT NULL REFERENCES public.shift_definitions(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time time,
  end_time time,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_definition_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_shift_definition_day_hours_branch
  ON public.shift_definition_day_hours(branch_id);

GRANT SELECT ON public.shift_definition_day_hours TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.shift_definition_day_hours TO authenticated;
GRANT ALL ON public.shift_definition_day_hours TO service_role;

ALTER TABLE public.shift_definition_day_hours ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS shift_def_day_hours_select ON public.shift_definition_day_hours;
CREATE POLICY shift_def_day_hours_select ON public.shift_definition_day_hours
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS shift_def_day_hours_insert ON public.shift_definition_day_hours;
CREATE POLICY shift_def_day_hours_insert ON public.shift_definition_day_hours
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin')
    OR public.has_role(auth.uid(), 'system_admin')
    OR public.has_schedule_manage_perm(auth.uid())
    OR public.has_schedule_publish_perm(auth.uid())
  );

DROP POLICY IF EXISTS shift_def_day_hours_update ON public.shift_definition_day_hours;
CREATE POLICY shift_def_day_hours_update ON public.shift_definition_day_hours
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin')
    OR public.has_role(auth.uid(), 'system_admin')
    OR public.has_schedule_manage_perm(auth.uid())
    OR public.has_schedule_publish_perm(auth.uid())
  )
  WITH CHECK (
    public.is_platform_owner(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin')
    OR public.has_role(auth.uid(), 'system_admin')
    OR public.has_schedule_manage_perm(auth.uid())
    OR public.has_schedule_publish_perm(auth.uid())
  );

DROP POLICY IF EXISTS shift_def_day_hours_delete ON public.shift_definition_day_hours;
CREATE POLICY shift_def_day_hours_delete ON public.shift_definition_day_hours
  FOR DELETE TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR public.has_role(auth.uid(), 'main_admin')
    OR public.has_role(auth.uid(), 'system_admin')
    OR public.has_schedule_manage_perm(auth.uid())
    OR public.has_schedule_publish_perm(auth.uid())
  );

DROP TRIGGER IF EXISTS trg_shift_definition_day_hours_updated_at ON public.shift_definition_day_hours;
CREATE TRIGGER trg_shift_definition_day_hours_updated_at
  BEFORE UPDATE ON public.shift_definition_day_hours
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.shift_definition_day_hours (
  shift_definition_id, day_of_week, start_time, end_time, branch_id
)
SELECT sd.id, dow, sd.start_time, sd.end_time, sd.branch_id
FROM public.shift_definitions sd
CROSS JOIN generate_series(0, 6) AS dow
WHERE sd.start_time IS NOT NULL
  AND sd.end_time IS NOT NULL
  AND sd.branch_id IS NOT NULL
ON CONFLICT (shift_definition_id, day_of_week) DO NOTHING;

NOTIFY pgrst, 'reload schema';
