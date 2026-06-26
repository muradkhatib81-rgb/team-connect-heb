
ALTER TABLE public.user_task_permissions
  ADD COLUMN IF NOT EXISTS can_publish_schedule boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.has_schedule_publish_perm(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(_user_id,'main_admin')
    OR ((public.has_role(_user_id,'branch_manager') OR public.has_role(_user_id,'assistant_manager'))
        AND EXISTS (SELECT 1 FROM public.user_task_permissions
                    WHERE user_id = _user_id AND can_publish_schedule = true));
$$;

REVOKE EXECUTE ON FUNCTION public.has_schedule_publish_perm(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_schedule_publish_perm(uuid) TO authenticated, service_role;
