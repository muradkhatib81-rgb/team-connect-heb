
ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS can_manage_breaks boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.break_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  order_index integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.break_settings TO authenticated;
GRANT ALL ON public.break_settings TO service_role;

ALTER TABLE public.break_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_break_manage_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR EXISTS (SELECT 1 FROM public.user_task_permissions
               WHERE user_id = _user_id AND can_manage_breaks = true);
$$;

REVOKE EXECUTE ON FUNCTION public.has_break_manage_perm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_break_manage_perm(uuid) TO authenticated, service_role;

CREATE POLICY "Anyone authenticated can view breaks"
  ON public.break_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Break managers can insert"
  ON public.break_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_break_manage_perm(auth.uid()));

CREATE POLICY "Break managers can update"
  ON public.break_settings FOR UPDATE TO authenticated
  USING (public.has_break_manage_perm(auth.uid()))
  WITH CHECK (public.has_break_manage_perm(auth.uid()));

CREATE POLICY "Break managers can delete"
  ON public.break_settings FOR DELETE TO authenticated
  USING (public.has_break_manage_perm(auth.uid()));

CREATE TRIGGER trg_break_settings_updated_at
  BEFORE UPDATE ON public.break_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.break_settings;
ALTER TABLE public.break_settings REPLICA IDENTITY FULL;
