-- Batch 1d follow-up: shift_definition_day_hours has its own branch_id.
DROP POLICY IF EXISTS shift_definition_day_hours_select_scoped ON public.shift_definition_day_hours;
CREATE POLICY shift_definition_day_hours_select_scoped
  ON public.shift_definition_day_hours
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    OR branch_id IS NOT DISTINCT FROM public.current_active_branch()
  );
