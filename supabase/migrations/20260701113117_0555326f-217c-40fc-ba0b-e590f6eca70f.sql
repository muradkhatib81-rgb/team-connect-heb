
CREATE TABLE public.management_on_shift (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, branch_id)
);

CREATE INDEX idx_management_on_shift_branch ON public.management_on_shift(branch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.management_on_shift TO authenticated;
GRANT ALL ON public.management_on_shift TO service_role;

ALTER TABLE public.management_on_shift ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can see who is on shift in their branch (or the active branch for sysadmins)
CREATE POLICY "mos_select_branch" ON public.management_on_shift
  FOR SELECT TO authenticated
  USING (
    branch_id = COALESCE(
      public.current_active_branch(),
      (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
    )
    OR public.is_system_admin(auth.uid())
  );

-- Only branch_manager or assistant_manager may mark themselves on shift
CREATE POLICY "mos_insert_self" ON public.management_on_shift
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'branch_manager'::public.app_role)
      OR public.has_role(auth.uid(), 'assistant_manager'::public.app_role)
    )
    AND branch_id = COALESCE(
      public.current_active_branch(),
      (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "mos_delete_self" ON public.management_on_shift
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'main_admin'::public.app_role)
    OR public.is_system_admin(auth.uid())
  );

-- RESTRICTIVE branch scope like other tables
CREATE POLICY "branch_scope_restriction" ON public.management_on_shift
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR branch_id = COALESCE(
      public.current_active_branch(),
      (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    public.is_system_admin(auth.uid())
    OR branch_id = COALESCE(
      public.current_active_branch(),
      (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.management_on_shift;
