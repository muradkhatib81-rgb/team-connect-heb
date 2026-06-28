
-- 1) Add schedule_type to company_settings
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS schedule_type text NOT NULL DEFAULT 'weekly';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_settings_schedule_type_chk'
  ) THEN
    ALTER TABLE public.company_settings
      ADD CONSTRAINT company_settings_schedule_type_chk
      CHECK (schedule_type IN ('weekly','monthly','custom'));
  END IF;
END $$;

-- 2) Stamp schedule type on each schedule row (so old ones aren't affected by setting changes)
ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS schedule_type text NOT NULL DEFAULT 'weekly';

-- 3) New permission: manage schedule settings
ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS can_manage_schedule boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.has_schedule_manage_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR EXISTS (SELECT 1 FROM public.user_task_permissions
               WHERE user_id = _user_id AND can_manage_schedule = true);
$$;

-- 4) Allow main_admin OR users with can_manage_schedule to update company_settings
DROP POLICY IF EXISTS company_settings_update_main_admin ON public.company_settings;
CREATE POLICY company_settings_update_main_admin
  ON public.company_settings
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(),'main_admin') OR public.has_schedule_manage_perm(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(),'main_admin') OR public.has_schedule_manage_perm(auth.uid()));
